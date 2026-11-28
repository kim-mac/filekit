import {
  degrees, PDFArray, PDFDict, PDFDocument, PDFNull, PDFObjectCopier, PDFPage, PDFPageLeaf, PDFRef, PDFStream, type PDFObject,
} from 'pdf-lib';
import type { ToolProgress } from '../../core/contracts';
import { imagePlacement } from '../../tools/pdf/layout';
import { rotationDegrees, type PageRef } from '../../tools/pdf/pages';
import { decodeImage, encodeImage } from '../image/codecs';
import { name, pageLinks, restoreBookmarks, restorePageLinks, sourceNavigation } from './navigation';

type PdfPageRef = Extract<PageRef, { kind: 'pdf' }>;
type ImagePageRef = Extract<PageRef, { kind: 'image' }>;
type Sources = Readonly<Record<string, Blob>>;
type Progress = (update: ToolProgress) => void;
type LoadSource = (id: string) => Promise<PDFDocument>;

function loadDocument(source: Blob) {
  return source.arrayBuffer().then(bytes => PDFDocument.load(bytes, { updateMetadata: false }));
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

function pruneUnreachable(pdf: PDFDocument) {
  const pending: (PDFObject | undefined)[] = Object.values(pdf.context.trailerInfo);
  const visited = new Set<PDFObject>();
  const included = new Set(pdf.getPages().map(page => page.ref));
  const pointsToOmittedPage = (value: PDFObject) =>
    value instanceof PDFRef && !included.has(value) && pdf.context.lookup(value) instanceof PDFPageLeaf;
  while (pending.length) {
    const object = pending.pop();
    if (!object || visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFRef) pending.push(pdf.context.lookup(object));
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (pointsToOmittedPage(value)) object.delete(key);
        else pending.push(value);
      }
    }
    if (object instanceof PDFArray) {
      object.asArray().forEach((value, index) => {
        if (pointsToOmittedPage(value)) object.set(index, PDFNull);
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
) {
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
  const canKeepCatalog = Boolean(starting && primary &&
    new Set(bySource.get(primary)?.map(page => page.index)).size === starting.getPageCount());
  // Reordering in the original catalog modifies it. Each output gets its own writable copy.
  if (load && canKeepCatalog && primary) starting = await loadDocument(sources[primary]);
  const output = canKeepCatalog && starting ? starting : await PDFDocument.create({ updateMetadata: false });
  if (starting && output !== starting && !strip) copyMetadata(starting, output);

  const imported = new Map<string, PDFPage>();
  const navigation: {
    source: ReturnType<typeof sourceNavigation>;
    pairs: { ref: PdfPageRef; original: ReturnType<typeof pageLinks> }[];
    targets: Map<number, PDFPage>;
  }[] = [];
  const maxSteps = pages.length + bySource.size + 1;
  let step = 0;
  const update = (message: string) => report?.({ message, step: ++step, totalSteps: maxSteps });
  for (const [id, group] of bySource) {
    update('Reading original PDF');
    const document = id === primary && starting ? starting
      : await read(id);
    if (document !== output && document.catalog.has(name('AcroForm'))) {
      // Copies preserve the appearance of fields. The primary catalog keeps live fields when every original page remains.
      try { document.getForm().flatten(); } catch { /* Some malformed forms have no usable field appearance. */ }
      await document.flush();
    }
    const originals = document.getPages();
    const rotations = originals.map(page => page.getRotation().angle);
    const source = sourceNavigation(document, originals);
    const targets = new Map<number, PDFPage>();
    const copier = PDFObjectCopier.for(document.context, output.context);
    const seen = new Set<number>();
    const pairs = group.map(ref => {
      const original = originals[ref.index];
      const links = pageLinks(original);
      const repeated = seen.has(ref.index);
      seen.add(ref.index);
      let page = original;
      if (document !== output || repeated) {
        const copy = repeated ? PDFObjectCopier.for(document.context, output.context) : copier;
        const node = copy.copy(original.node);
        page = PDFPage.of(node, output.context.register(node), output);
        for (const annotation of pageLinks(page)) {
          if (annotation?.has(name('P'))) annotation.set(name('P'), page.ref);
        }
      }
      page.setRotation(degrees(rotationDegrees(rotations[ref.index] + ref.rotation)));
      if (strip) page.node.delete(name('Metadata'));
      imported.set(ref.id, page);
      if (!targets.has(ref.index)) targets.set(ref.index, page);
      return { ref, original: links };
    });
    navigation.push({ source, pairs, targets });
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
    restoreBookmarks(output, navigation.map(({ source, targets }) => ({ bookmarks: source.bookmarks, targets })));
  }

  const images = new Map<string, Awaited<ReturnType<typeof embedImage>>>();
  for (const ref of pages) {
    update('Writing page');
    if (ref.kind === 'pdf') output.addPage(imported.get(ref.id)!);
    if (ref.kind === 'blank') output.addPage([ref.size.width, ref.size.height]).setRotation(degrees(ref.rotation));
    if (ref.kind === 'image') {
      let image = images.get(ref.source);
      if (!image) {
        image = await embedImage(output, sources[ref.source]);
        images.set(ref.source, image);
      }
      drawImagePage(output, ref, image);
    }
  }
  if (strip) {
    output.context.trailerInfo.Info = undefined;
    output.catalog.delete(name('Metadata'));
  }
  update('Saving PDF');
  await output.flush();
  pruneUnreachable(output);
  return output.save({ updateFieldAppearances: false });
}

function drawImagePage(output: PDFDocument, ref: ImagePageRef, image: Awaited<ReturnType<typeof embedImage>>) {
  const { width, height, imageWidth, imageHeight } = imagePlacement(image.width, image.height, ref.layout);
  const page = output.addPage([width, height]);
  page.setRotation(degrees(ref.rotation));
  page.drawImage(image, { x: (width - imageWidth) / 2, y: (height - imageHeight) / 2, width: imageWidth, height: imageHeight });
}
