import { expose, releaseProxy } from 'comlink';
import { exportPdf } from './pdf/export';
import type { PdfWorkerApi, ReportPdfProgress } from './pdf/types';

let renderer: Promise<import('./pdf/render').PdfRenderer> | undefined;
const getRenderer = () => renderer ??= import('./pdf/render').then(({ PdfRenderer }) => new PdfRenderer());

// A preview or intake owns the rendering surface and cache until it finishes.
let queue = Promise.resolve();
function serial<T>(run: () => Promise<T>) {
  const result = queue.then(run);
  queue = result.then(() => {}, () => {});
  return result;
}

async function reportUntilDone<T>(report: ReportPdfProgress, run: () => Promise<T>) {
  try {
    return await run();
  } finally {
    (report as ReportPdfProgress & { [releaseProxy]?: () => void })[releaseProxy]?.();
  }
}

expose({
  inspect: (id, file, kind, password, mobile, report) => serial(() => reportUntilDone(report, async () => {
    const render = await getRenderer();
    return render.inspect(id, file, kind, password, mobile, report);
  })),
  preview: (page, source, edge, mobile) => serial(async () => {
    const render = await getRenderer();
    return render.preview(page, source, edge, mobile);
  }),
  size: (page, source, mobile) => serial(async () => (await getRenderer()).size(page, source, mobile)),
  retain: ids => serial(async () => { await (await renderer)?.retain(ids); }),
  export: (request, report) => reportUntilDone(report, () => exportPdf(request, report, getRenderer)),
} satisfies PdfWorkerApi);
