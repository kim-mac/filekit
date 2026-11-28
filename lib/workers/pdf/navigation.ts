import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString,
  type PDFObject, type PDFPage,
} from 'pdf-lib';

export const name = PDFName.of;
const asDict = (value: PDFObject | undefined) => value instanceof PDFDict ? value : undefined;
const asArray = (value: PDFObject | undefined) => value instanceof PDFArray ? value : undefined;
const asText = (value: PDFObject | undefined) =>
  value instanceof PDFString || value instanceof PDFHexString || value instanceof PDFName ? value.decodeText() : undefined;

type Destination = { index: number; view: PDFObject[] };
type Navigation = { destination: Destination } | { uri: string };
interface Bookmark {
  title: string;
  children: Bookmark[];
  navigation?: Navigation;
}

export function sourceNavigation(document: PDFDocument, pages: readonly PDFPage[]) {
  const pageIndices = new Map(pages.map((page, index) => [page.ref, index]));
  const named = new Map<string, PDFObject>();
  const legacy = asDict(document.catalog.lookup(name('Dests')));
  for (const [key, value] of legacy?.entries() ?? []) named.set(key.decodeText(), value);
  const seenTrees = new Set<PDFDict>();
  function readNames(tree: PDFDict | undefined) {
    if (!tree || seenTrees.has(tree)) return;
    seenTrees.add(tree);
    const entries = asArray(tree.lookup(name('Names')));
    if (entries) {
      for (let i = 0; i + 1 < entries.size(); i += 2) {
        const key = asText(entries.lookup(i));
        if (key !== undefined) named.set(key, entries.get(i + 1));
      }
    }
    const kids = asArray(tree.lookup(name('Kids')));
    for (const child of kids?.asArray() ?? []) readNames(asDict(document.context.lookup(child)));
  }
  readNames(asDict(asDict(document.catalog.lookup(name('Names')))?.lookup(name('Dests'))));

  function resolve(value: PDFObject | undefined): Destination | undefined {
    const key = asText(value);
    const object = key === undefined ? value : document.context.lookup(named.get(key));
    const array = asArray(asDict(object)?.lookup(name('D')) ?? object);
    if (!array) return;
    const page = array.get(0);
    const index = page instanceof PDFRef ? pageIndices.get(page) : page instanceof PDFNumber ? page.asNumber() : undefined;
    if (index === undefined || index < 0 || index >= pages.length) return;
    const view = array.asArray().slice(1).map(item => {
      const value = document.context.lookup(item);
      return value instanceof PDFName || value instanceof PDFNumber ? value : PDFNull;
    });
    return { index, view };
  }

  function navigation(dict: PDFDict): Navigation | undefined {
    const action = asDict(dict.lookup(name('A')));
    const kind = action?.get(name('S'));
    const uri = kind === name('URI') ? asText(action?.lookup(name('URI'))) : undefined;
    if (uri !== undefined) return { uri };
    const dest = resolve(dict.lookup(name('Dest')) ?? (kind === name('GoTo') ? action?.lookup(name('D')) : undefined));
    if (dest) return { destination: dest };
  }

  const visited = new Set<PDFDict>();
  function readOutline(parent: PDFDict | undefined, depth = 0): Bookmark[] {
    if (depth >= 64) return [];
    const bookmarks: Bookmark[] = [];
    let item = asDict(parent?.lookup(name('First')));
    while (item && !visited.has(item)) {
      visited.add(item);
      bookmarks.push({ title: asText(item.lookup(name('Title'))) ?? 'Bookmark', navigation: navigation(item), children: readOutline(item, depth + 1) });
      item = asDict(item.lookup(name('Next')));
    }
    return bookmarks;
  }
  return { resolve, bookmarks: readOutline(asDict(document.catalog.lookup(name('Outlines')))) };
}

export function pageLinks(page: PDFPage) {
  return (page.node.Annots()?.asArray() ?? []).map(ref => asDict(page.doc.context.lookup(ref)));
}

function remap(destination: Destination | undefined, targets: ReadonlyMap<number, PDFPage>, output: PDFDocument) {
  const page = destination && targets.get(destination.index);
  if (!page) return;
  const value = output.context.obj([]);
  value.push(page.ref);
  for (const item of destination.view) value.push(item);
  return value;
}

export function restorePageLinks(
  original: ReturnType<typeof pageLinks>,
  page: PDFPage,
  resolve: ReturnType<typeof sourceNavigation>['resolve'],
  targets: ReadonlyMap<number, PDFPage>,
) {
  pageLinks(page).forEach((link, index) => {
    const source = original[index];
    if (!source || !link || source.get(name('Subtype')) !== name('Link')) return;
    const action = asDict(source.lookup(name('A')));
    const direct = source.lookup(name('Dest'));
    const internal = direct !== undefined || action?.get(name('S')) === name('GoTo');
    if (!internal) return;
    const target = remap(resolve(direct ?? action?.lookup(name('D'))), targets, page.doc);
    link.delete(name('A'));
    if (target) link.set(name('Dest'), target);
    else link.delete(name('Dest'));
  });
}

export function restoreBookmarks(
  output: PDFDocument,
  groups: readonly { bookmarks: readonly Bookmark[]; targets: ReadonlyMap<number, PDFPage>; redacted?: ReadonlySet<number> }[],
) {
  const context = output.context;
  interface OutlineItem { title: string; dest?: PDFArray; uri?: string; children: OutlineItem[] }
  function prepare(bookmarks: readonly Bookmark[], targets: ReadonlyMap<number, PDFPage>, redacted?: ReadonlySet<number>): OutlineItem[] {
    return bookmarks.flatMap(bookmark => {
      const navigation = bookmark.navigation;
      const destination = navigation && 'destination' in navigation ? navigation.destination : undefined;
      const dest = remap(destination, targets, output);
      const uri = navigation && 'uri' in navigation ? navigation.uri : undefined;
      const children = prepare(bookmark.children, targets, redacted);
      if (destination && redacted?.has(destination.index)) return children;
      return dest || uri || children.length ? [{ title: bookmark.title, dest, uri, children }] : [];
    });
  }
  const items = groups.flatMap(({ bookmarks, targets, redacted }) => prepare(bookmarks, targets, redacted));
  if (!items.length) {
    output.catalog.delete(name('Outlines'));
    return;
  }
  const root = context.obj({ Type: 'Outlines' });
  const rootRef = context.register(root);
  function write(items: OutlineItem[], parent: PDFDict, parentRef: PDFRef) {
    if (!items.length) return 0;
    const siblings = items.map(item => {
      const dict = context.obj({ Title: PDFHexString.fromText(item.title), Parent: parentRef });
      if (item.dest) dict.set(name('Dest'), item.dest);
      if (item.uri) dict.set(name('A'), context.obj({ S: 'URI', URI: PDFString.of(item.uri) }));
      return { dict, ref: context.register(dict), children: item.children };
    });
    parent.set(name('First'), siblings[0].ref);
    parent.set(name('Last'), siblings[siblings.length - 1].ref);
    let count = siblings.length;
    siblings.forEach(({ dict, ref, children }, index) => {
      if (index > 0) dict.set(name('Prev'), siblings[index - 1].ref);
      if (index + 1 < siblings.length) dict.set(name('Next'), siblings[index + 1].ref);
      count += write(children, dict, ref);
    });
    parent.set(name('Count'), PDFNumber.of(count));
    return count;
  }
  write(items, root, rootRef);
  output.catalog.set(name('Outlines'), rootRef);
}
