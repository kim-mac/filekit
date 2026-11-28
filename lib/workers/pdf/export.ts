import { createBlobZip } from '../blob-zip';
import { imagePage, pdfPages, replayPages, type PageRef } from '../../tools/pdf/pages';
import { imagePlacement, type ImageLayout, type PageSize } from '../../tools/pdf/layout';
import { boxBetween, hasRedactions, isAppliedRedaction, type Box, type Overlay } from '../../tools/pdf/overlay';
import type { PdfRenderer } from './render';
import type { ExportRequest, ExportResult, ReportPdfProgress } from './types';

export async function exportPdf(request: ExportRequest, report: ReportPdfProgress, renderer: () => Promise<PdfRenderer>): Promise<ExportResult> {
  const { raster, baseName, primary, sources, strip } = request;
  const selected = new Set(request.groups.flat());
  const pages = await protectCopies(replayPages(request.initial, request.commands), selected, async source =>
    (await renderer()).size(imagePage(source), sources[source], request.mobile ?? false));
  const groups = request.groups.map(indices => {
    const seen = new Set<number>();
    return indices.map((index, occurrence) => {
      const page = pages[index];
      const duplicate = seen.has(index);
      seen.add(index);
      return duplicate ? { ...page, id: `repeat:${occurrence}:${page.id}` } : page;
    });
  });
  const zip = groups.length > 1 || request.archive ? createBlobZip() : undefined;
  const extension = raster ? (raster.format === 'jpeg' ? 'jpg' : raster.format) : 'pdf';
  let limited = false;
  let offset = 0;
  if (groups.some(group => group.some(page => page.objects?.some(object => object.kind === 'redaction' && !object.applied)))) {
    throw new Error('Apply or remove the marked redactions before exporting.');
  }
  const steps = groups.map(group => raster ? 1
    : group.length + new Set(group.flatMap(page => page.kind === 'pdf' ? [page.source] : [])).size + 1 + Number(group.some(page => hasRedactions(page.objects))));
  const totalSteps = steps.reduce((sum, step) => sum + step, zip ? 1 : 0);
  const rasterizer = raster ? await renderer() : undefined;
  const writer = !raster || groups.some(group => group.some(page => page.objects?.length || page.fields))
    ? await import('./write') : undefined;
  const load = groups.length > 1 && !raster ? writer?.reusePdfSources(sources) : undefined;
  for (const [index, group] of groups.entries()) {
    let blob: Blob;
    if (raster && rasterizer) {
      report({ message: `Rendering page ${raster.pageNumbers[index]}`, step: index + 1, totalSteps });
      let page = group[0];
      let source = page.kind === 'blank' ? undefined : sources[page.source];
      const masks = page.objects?.filter(isAppliedRedaction).map(object => object.box);
      if (page.objects?.length || page.fields) {
        const bytes = await writer!.writePdf(sources, [page], page.kind === 'pdf' ? page.source : undefined, true, undefined, undefined,
          { flattenFields: true, rasterSource: true });
        source = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        page = pdfPages(`raster:${index}`, 1)[0];
      }
      const result = await rasterizer.raster(page, source, raster, masks);
      blob = result.blob;
      limited ||= result.limited;
    } else {
      const secure = group.some(page => hasRedactions(page.objects));
      const bytes = await writer!.writePdf(sources, group, primary, strip, update => {
        report({ ...update, step: offset + update.step, totalSteps });
      }, load, {
        editableHighlights: request.editableHighlights, flattenFields: request.flattenFields,
        redactedPage: secure ? async (source, masks) => {
          const render = await renderer();
          const ref = pdfPages(crypto.randomUUID(), 1)[0];
          const mobile = request.mobile ?? false;
          const size = await render.size(ref, source, mobile);
          const result = await render.raster(ref, source, { format: 'png', dpi: 150, mobile }, masks);
          limited ||= result.limited;
          await render.retain([]);
          return { blob: result.blob, size };
        } : undefined,
      });
      blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      if (secure) {
        report({ message: 'Removing unused PDF resources', step: offset + steps[index], totalSteps });
        const { removeUnusedResources } = await import('./unlock');
        blob = await removeUnusedResources(blob);
      }
    }
    offset += steps[index];
    const suffix = raster ? `-page-${raster.pageNumbers[index]}` : zip ? `-part-${index + 1}` : '';
    const name = `${baseName}${suffix}.${extension}`;
    if (!zip) return { blob, name, limited };
    await zip.add(name, blob);
  }
  if (!zip) throw new Error('Choose at least one page to export.');
  report({ message: 'Finishing ZIP', step: totalSteps, totalSteps });
  return { blob: zip.finish(), name: `${baseName}.zip`, limited };
}

async function protectCopies(pages: readonly PageRef[], selected: ReadonlySet<number>,
  imageSize: (source: string) => Promise<PageSize>): Promise<readonly PageRef[]> {
  const key = (page: PageRef) => page.kind === 'blank' ? undefined
    : JSON.stringify([page.kind, page.source, page.kind === 'pdf' ? page.index : null]);
  const marked = new Map<string, { page: PageRef; object: Extract<Overlay, { kind: 'redaction' }> }[]>();
  const sizes = new Map<string, Promise<PageSize>>();
  for (const page of pages) {
    const source = key(page);
    if (source === undefined || !hasRedactions(page.objects)) continue;
    const masks = marked.get(source) ?? [];
    for (const object of page.objects ?? []) {
      if (isAppliedRedaction(object)) masks.push({ page, object });
    }
    marked.set(source, masks);
  }
  if (!marked.size) return pages;
  return Promise.all(pages.map(async (page, index) => {
    const siblings = marked.get(key(page) ?? '');
    if (!siblings || !selected.has(index)) return page;
    const masks = new Map<string, Overlay>();
    for (const { page: original, object } of siblings) {
      let box: Box | undefined = object.box;
      if (page.kind === 'image' && original.kind === 'image' && JSON.stringify(page.layout) !== JSON.stringify(original.layout)) {
        let size = sizes.get(page.source);
        if (!size) {
          size = imageSize(page.source);
          sizes.set(page.source, size);
        }
        box = mapImageMask(box, await size, original.layout, page.layout);
      }
      if (box) masks.set(JSON.stringify(box), { ...object, box });
    }
    return { ...page, objects: [...page.objects?.filter(object => !isAppliedRedaction(object)) ?? [], ...masks.values()] };
  }));
}

function mapImageMask(mask: Box, size: PageSize, from: ImageLayout, to: ImageLayout) {
  const area = (layout: ImageLayout) => {
    const { width, height, imageWidth, imageHeight } = imagePlacement(size.width, size.height, layout);
    return { x: (width - imageWidth) / 2, y: (height - imageHeight) / 2, width: imageWidth, height: imageHeight };
  };
  const source = area(from);
  const target = area(to);
  const x = Math.max(source.x, mask.x);
  const y = Math.max(source.y, mask.y);
  const right = Math.min(source.x + source.width, mask.x + mask.width);
  const top = Math.min(source.y + source.height, mask.y + mask.height);
  if (right <= x || top <= y) return undefined;
  const translate = (x: number, y: number) => ({
    x: target.x + (x - source.x) / source.width * target.width,
    y: target.y + (y - source.y) / source.height * target.height,
  });
  return boxBetween(translate(x, y), translate(right, top));
}
