import {
  degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFNull, PDFNumber, PDFObjectCopier, PDFPage, PDFPageLeaf,
  PDFRef, PDFStream, PDFString, type PDFObject,
} from 'pdf-lib';
import type { ToolProgress } from '../../core/contracts';
import { imagePlacement } from '../../tools/pdf/layout';
import { hasRedactions, isAppliedRedaction, type Box } from '../../tools/pdf/overlay';
import { pageRenderKey, rotationDegrees, type PageRef } from '../../tools/pdf/pages';
import { decodeImage, encodeImage } from '../image/codecs';
import { name, pageLinks, restoreBookmarks, restorePageLinks, sourceNavigation } from './navigation';
import { fillFields, importFormFields, updateFields } from './forms';
import { overlayResources, writeOverlays, type LoadFont } from './overlay-write';
import type { PdfEditExportOptions } from './types';

type PdfPageRef = Extract<PageRef, { kind: 'pdf' }>;
type ImagePageRef = Extract<PageRef, { kind: 'image' }>;
type Sources = Readonly<Record<string, Blob>>;
type Progress = (update: ToolProgress) => void;
type LoadSource = (id: string) => Promise<PDFDocument>;

function loadDocument(source: Blob) {
  return source.arrayBuffer().then(bytes => PDFDocument.load(bytes, { updateMetadata: false }));
}

interface WriteOptions extends PdfEditExportOptions {
  loadFont?: LoadFont;
  rasterSource?: boolean;
  redactedPage?: (source: Blob, masks: Box[]) => Promise<{ blob: Blob; size: { width: number; height: number } }>;
}

export function reusePdfSources(sources: Sources): LoadSource {
  const recent = new Map<string, PDFDocument>();
  return async id => {
    const document = recent.get(id) ?? await loadDocument(sources[id]);
    recent.delete(id);
    recent.set(id, document);
    const budget = 48 * 1024 * 1024;
    let bytes = [...recent.keys()].reduce((total, key) => total + sources[key].size, 0);
    for (const key of recent.keys()) {
      if (key === id || (recent.size <= 2 && bytes <= budget)) break;
      recent.delete(key);
      bytes -= sources[key].size;
    }
    return document;
  };
}

const privateKeys = new Set(['Metadata', 'PieceInfo', 'AF', 'EmbeddedFiles', 'AA', 'OpenAction', 'Thumb', 'SpiderInfo']);
const resourceKeys = ['XObject', 'Font', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties'];

function pruneUnreachable(pdf: PDFDocument, secure: boolean) {
  const pending: (PDFObject | undefined)[] = Object.values(pdf.context.trailerInfo);
  const visited = new Set<PDFObject>();
  const included = new Set(pdf.getPages().map(page => page.ref));
  const resourceMaps = new Set<PDFObject>();
  const pointsToOmittedPage = (value: PDFObject) =>
    value instanceof PDFRef && !included.has(value) && pdf.context.lookup(value) instanceof PDFPageLeaf;
  const pointsToAttachment = (value: PDFObject) => {
    if (!secure) return false;
    const target = pdf.context.lookup(value);
    const dict = target instanceof PDFStream ? target.dict : target;
    return dict instanceof PDFDict && (dict.get(name('Type')) === name('Filespec') || dict.get(name('Type')) === name('EmbeddedFile'));
  };
  while (pending.length) {
    const object = pending.pop();
    if (!object || visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFRef) pending.push(pdf.context.lookup(object));
    if (object instanceof PDFDict) {
      const resources = secure ? object.lookup(name('Resources')) : undefined;
      if (resources instanceof PDFDict) {
        for (const key of resourceKeys) {
          const map = resources.lookup(name(key));
          if (map) resourceMaps.add(map);
        }
      }
      for (const [key, value] of object.entries()) {
        if (pointsToOmittedPage(value) || pointsToAttachment(value) ||
          secure && !resourceMaps.has(object) && privateKeys.has(key.decodeText())) object.delete(key);
        else pending.push(value);
      }
    }
    if (object instanceof PDFArray) {
      object.asArray().forEach((value, index) => {
        if (pointsToOmittedPage(value) || pointsToAttachment(value)) object.set(index, PDFNull);
        else pending.push(value);
      });
    }
    if (object instanceof PDFStream) pending.push(object.dict);
  }
  for (const [ref] of pdf.context.enumerateIndirectObjects()) {
    if (!visited.has(ref)) pdf.context.delete(ref);
  }
}

function copyMetadata(from: PDFDocument, to: PDFDocument) {
  const copier = PDFObjectCopier.for(from.context, to.context);
  const info = from.context.trailerInfo.Info;
  const metadata = from.catalog.get(name('Metadata'));
  if (info) to.context.trailerInfo.Info = copier.copy(info);
  if (metadata) to.catalog.set(name('Metadata'), copier.copy(metadata));
}

async function embedImage(output: PDFDocument, source: Blob) {
  const { frame, format } = await decodeImage(source);
  const jpeg = format === 'jpeg';
  const blob = await encodeImage(frame, { format: jpeg ? 'jpeg' : 'png', quality: 98, background: '#ffffff' });
  const bytes = await blob.arrayBuffer();
  return jpeg ? output.embedJpg(bytes) : output.embedPng(bytes);
}

export async function writePdf(
  sources: Sources, pages: readonly PageRef[], primary: string | undefined, strip: boolean, report?: Progress, load?: LoadSource,
  options: WriteOptions = {},
) {
  const needsRedaction = pages.some(page => hasRedactions(page.objects));
  if (needsRedaction && !options.redactedPage && !options.rasterSource) throw new Error('Secure redaction rendering is unavailable.');
  const secure = Boolean(options.redactedPage && needsRedaction);
  if (secure) strip = true;
  const bySource = new Map<string, PdfPageRef[]>();
  for (const page of pages) {
    if (page.kind !== 'pdf') continue;
    const group = bySource.get(page.source);
    if (group) group.push(page);
    else bySource.set(page.source, [page]);
  }
  if (!pages.length) throw new Error('Keep at least one page in the PDF.');
  const read = load ?? ((id: string) => loadDocument(sources[id]));
  let starting = primary && sources[primary] ? await read(primary) : undefined;
  const canKeepCatalog = Boolean(!secure && starting && primary &&
    new Set(bySource.get(primary)?.map(page => page.index)).size === starting.getPageCount());
  // Reordering in the original catalog modifies it. Each output gets its own writable copy.
  if (load && canKeepCatalog && primary) starting = await loadDocument(sources[primary]);
  const output = canKeepCatalog && starting ? starting : await PDFDocument.create({ updateMetadata: false });
  if (starting && output !== starting && !strip) copyMetadata(starting, output);
  const resources = overlayResources(output, options.loadFont);
  const redactedRasters = new Map<string, Awaited<ReturnType<NonNullable<WriteOptions['redactedPage']>>>>();

  async function replaceRedacted(ref: PageRef) {
    const objects = ref.objects!;
    const masks = objects.filter(isAppliedRedaction).map(object => object.box);
    const key = objects.some(object => object.kind !== 'redaction') ? undefined : JSON.stringify([pageRenderKey(ref), ref.fields, masks]);
    let rendered = key === undefined ? undefined : redactedRasters.get(key);
    if (!rendered) {
      const original = ref.kind === 'pdf' ? ref.source : undefined;
      const bytes = await writePdf(sources, [ref], original, true, undefined, undefined, {
        ...options, redactedPage: undefined, rasterSource: true, flattenFields: true, editableHighlights: false,
      });
      rendered = await options.redactedPage!(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), masks);
      if (key !== undefined) redactedRasters.set(key, rendered);
    }
    const page = output.addPage([rendered.size.width, rendered.size.height]);
    output.removePage(output.getPageCount() - 1);
    page.drawImage(await resources.image(rendered.blob), { x: 0, y: 0, ...rendered.size });
    return page;
  }

  const imported = new Map<string, PDFPage>();
  const navigation: {
    source: ReturnType<typeof sourceNavigation>;
    pairs: { ref: PdfPageRef; original: ReturnType<typeof pageLinks> }[];
    targets: Map<number, PDFPage>;
    redacted: Set<number>;
  }[] = [];
  const maxSteps = pages.length + bySource.size + 1;
  let step = 0;
  const update = (message: string) => report?.({ message, step: ++step, totalSteps: maxSteps });
  for (const [id, group] of bySource) {
    update('Reading original PDF');
    const values = Object.assign(Object.create(null), ...group.map(page => page.fields)) as NonNullable<PageRef['fields']>;
    const changed = Object.keys(values).length > 0;
    const document = id === primary && starting === output ? output
      : load && (changed || options.flattenFields || secure) ? await loadDocument(sources[id])
      : id === primary && starting ? starting
      : await read(id);
    if (document.catalog.has(name('AcroForm'))) {
      const flatten = secure || Boolean(options.flattenFields);
      if (changed || flatten) {
        if (changed) fillFields(document, values);
        const formResources = document === output ? resources : overlayResources(document, options.loadFont);
        updateFields(document, await formResources.font('lato'), flatten, values);
      }
      await document.flush();
    }
    const originals = document.getPages();
    const rotations = originals.map(page => page.getRotation().angle);
    const source = sourceNavigation(document, originals);
    const targets = new Map<number, PDFPage>();
    const redacted = new Set<number>();
    const copier = PDFObjectCopier.for(document.context, output.context);
    const seen = new Set<number>();
    const copied: PDFPage[] = [];
    const repeatedPages: PDFPage[] = [];
    const pairs: typeof navigation[number]['pairs'] = [];
    for (const ref of group) {
      const original = originals[ref.index];
      if (secure && hasRedactions(ref.objects)) {
        update('Rasterizing redacted page');
        const replacement = await replaceRedacted(ref);
        imported.set(ref.id, replacement);
        redacted.add(ref.index);
        if (!targets.has(ref.index)) targets.set(ref.index, replacement);
        continue;
      }
      const links = pageLinks(original);
      const repeated = seen.has(ref.index);
      seen.add(ref.index);
      let page = original;
      if (document !== output || repeated) {
        const copy = repeated ? PDFObjectCopier.for(document.context, output.context) : copier;
        const node = copy.copy(secure ? safePage(original) : original.node);
        page = PDFPage.of(node, output.context.register(node), output);
        if (repeated) repeatedPages.push(page);
        else copied.push(page);
        for (const annotation of pageLinks(page)) {
          if (annotation?.has(name('P'))) annotation.set(name('P'), page.ref);
        }
      }
      page.setRotation(degrees(rotationDegrees(rotations[ref.index] + ref.rotation)));
      if (strip) page.node.delete(name('Metadata'));
      imported.set(ref.id, page);
      if (!targets.has(ref.index)) targets.set(ref.index, page);
      pairs.push({ ref, original: secure ? links.filter(link => link?.get(name('Subtype')) === name('Link')) : links });
    }
    if (!secure && !options.flattenFields) {
      importFormFields(output, copied, document, copier);
      for (const page of repeatedPages) importFormFields(output, [page], document, copier);
    }
    navigation.push({ source, pairs, targets, redacted });
    if (document === output) {
      // Reparent leaves after materializing inherited values. Original page references remain valid.
      for (const page of originals) {
        for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
          const property = name(key);
          const value = page.node.getInheritableAttribute(property);
          if (value !== undefined) page.node.set(property, value);
        }
      }
      for (let index = originals.length - 1; index >= 0; index--) output.removePage(index);
    }
  }
  for (const { source, pairs, targets } of navigation) {
    for (const { ref, original } of pairs) restorePageLinks(original, imported.get(ref.id)!, source.resolve, targets);
  }
  if (!canKeepCatalog || navigation.length > 1) {
    restoreBookmarks(output, navigation.map(({ source, targets, redacted }) => ({ bookmarks: source.bookmarks, targets, redacted })));
  }

  const images = new Map<string, Awaited<ReturnType<typeof embedImage>>>();
  for (const ref of pages) {
    const redacted = secure && hasRedactions(ref.objects);
    if (!(ref.kind === 'pdf' && redacted)) update(redacted ? 'Rasterizing redacted page' : 'Writing page');
    let page: PDFPage;
    if (ref.kind === 'pdf') page = output.addPage(imported.get(ref.id)!);
    else if (redacted) page = output.addPage(await replaceRedacted(ref));
    else if (ref.kind === 'blank') {
      page = output.addPage([ref.size.width, ref.size.height]);
      page.setRotation(degrees(ref.rotation));
    }
    else {
      let image = images.get(ref.source);
      if (!image) {
        image = await embedImage(output, sources[ref.source]);
        images.set(ref.source, image);
      }
      page = drawImagePage(output, ref, image);
    }
    if (!redacted && ref.objects?.length) await writeOverlays(page, ref.objects, resources, Boolean(options.editableHighlights));
  }
  if (strip) {
    output.context.trailerInfo.Info = undefined;
    output.catalog.delete(name('Metadata'));
  }
  update('Saving PDF');
  await output.flush();
  pruneUnreachable(output, secure);
  return output.save({ updateFieldAppearances: false });
}

// Start with only the page rendering keys. Private page data, attachments,
// actions, and annotation appearances can reference content from removed pages.
function safePage(page: PDFPage) {
  const node = page.node.clone();
  const allowed = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'Rotate', 'Resources', 'Contents', 'Group', 'UserUnit']);
  for (const [key] of node.entries()) {
    if (!allowed.has(key.decodeText())) node.delete(key);
  }
  const context = page.doc.context;
  const links = pageLinks(page).filter(link => link?.get(name('Subtype')) === name('Link'));
  if (links.length) node.set(name('Annots'), context.obj(links.map(link => {
    const annotation = context.obj({ Type: 'Annot', Subtype: 'Link' });
    for (const key of ['Rect', 'Border', 'C', 'QuadPoints']) {
      const value = link?.lookup(name(key));
      if (value instanceof PDFArray) {
        const numbers = value.asArray().filter(item => item instanceof PDFNumber);
        if (numbers.length) annotation.set(name(key), context.obj(numbers));
      }
    }
    const action = link?.lookup(name('A'));
    if (action instanceof PDFDict && action.get(name('S')) === name('URI')) {
      const uri = action.lookup(name('URI'));
      if (uri instanceof PDFString || uri instanceof PDFHexString) {
        const safeAction = context.obj({ S: 'URI' });
        safeAction.set(name('URI'), uri);
        annotation.set(name('A'), safeAction);
      }
    }
    return annotation;
  })));
  return node;
}

function drawImagePage(output: PDFDocument, ref: ImagePageRef, image: Awaited<ReturnType<typeof embedImage>>) {
  const { width, height, imageWidth, imageHeight } = imagePlacement(image.width, image.height, ref.layout);
  const page = output.addPage([width, height]);
  page.setRotation(degrees(ref.rotation));
  page.drawImage(image, { x: (width - imageWidth) / 2, y: (height - imageHeight) / 2, width: imageWidth, height: imageHeight });
  return page;
}
