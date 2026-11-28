import { proxy, releaseProxy, wrap, type Remote } from 'comlink';
import type { PageRef } from '../../tools/pdf/pages';
import type { ExportRequest, IntakeResult, PdfWorkerApi, ReportPdfProgress } from './types';

export class PdfWorkerClient {
  private worker?: Worker;
  private remote?: Remote<PdfWorkerApi>;
  private readonly jobs = new Set<(reason: Error) => void>();

  private connect() {
    if (this.remote) return this.remote;
    const worker = new Worker(new URL('/workers/pdf.worker.js', window.location.origin), { type: 'module' });
    const failed = () => {
      if (this.worker === worker) this.stop(new Error('The PDF worker stopped. Try again with fewer pages or a smaller file.'));
    };
    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    this.worker = worker;
    return this.remote = wrap<PdfWorkerApi>(worker);
  }

  private async call<T>(run: (worker: Remote<PdfWorkerApi>) => Promise<T>) {
    const remote = this.connect();
    let rejectJob!: (reason: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectJob = reject; });
    this.jobs.add(rejectJob);
    try {
      return await Promise.race([run(remote), interrupted]);
    } finally {
      this.jobs.delete(rejectJob);
    }
  }

  inspect(id: string, file: File, kind: 'pdf' | 'image', password: string | undefined, mobile: boolean,
    report: ReportPdfProgress) {
    return this.call<IntakeResult>(worker => worker.inspect(id, file, kind, password, mobile, proxy(report)));
  }

  preview(page: PageRef, source: Blob | undefined, edge: number, mobile: boolean) {
    return this.call(worker => worker.preview(page, source, edge, mobile));
  }

  size(page: PageRef, source: Blob | undefined, mobile: boolean) {
    return this.call(worker => worker.size(page, source, mobile));
  }

  retain(ids: string[]) {
    if (this.remote) void this.call(worker => worker.retain(ids)).catch(() => {});
  }

  export(request: ExportRequest, report: ReportPdfProgress) {
    return this.call(worker => worker.export(request, proxy(report)));
  }

  stop(error: Error = new DOMException('PDF processing canceled.', 'AbortError')) {
    for (const reject of this.jobs) reject(error);
    this.jobs.clear();
    this.remote?.[releaseProxy]();
    this.worker?.terminate();
    this.remote = undefined;
    this.worker = undefined;
  }
}
