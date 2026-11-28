import { createBlobZip } from '../blob-zip';
import { replayPages } from '../../tools/pdf/pages';
import type { PdfRenderer } from './render';
import type { ExportRequest, ExportResult, ReportPdfProgress } from './types';

export async function exportPdf(request: ExportRequest, report: ReportPdfProgress, renderer: () => Promise<PdfRenderer>): Promise<ExportResult> {
  const { raster, baseName, primary, sources, strip } = request;
  const pages = replayPages(request.initial, request.commands);
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
  const steps = groups.map(group => raster ? 1
    : group.length + new Set(group.flatMap(page => page.kind === 'pdf' ? [page.source] : [])).size + 1);
  const totalSteps = steps.reduce((sum, step) => sum + step, zip ? 1 : 0);
  const rasterizer = raster ? await renderer() : undefined;
  const writer = raster ? undefined : await import('./write');
  const load = groups.length > 1 ? writer?.reusePdfSources(sources) : undefined;
  for (const [index, group] of groups.entries()) {
    let blob: Blob;
    if (raster && rasterizer) {
      report({ message: `Rendering page ${raster.pageNumbers[index]}`, step: index + 1, totalSteps });
      const page = group[0];
      const result = await rasterizer.raster(page, page.kind === 'blank' ? undefined : sources[page.source], raster);
      blob = result.blob;
      limited ||= result.limited;
    } else {
      const bytes = await writer!.writePdf(sources, group, primary, strip, update => {
        report({ ...update, step: offset + update.step, totalSteps });
      }, load);
      blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
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
