import { proxy, releaseProxy, wrap, type Remote } from 'comlink';
import type { ComparisonRequest, ImageRequest, ImageWorkerApi, ProgressCallback } from './image/types';

export class ImageWorkerClient {
  private worker?: Worker;
  private remote?: Remote<ImageWorkerApi>;
  private rejectJob?: (error: Error) => void;
  private rejectDraft?: (error: Error) => void;
  private rejectComparison?: (error: Error) => void;

  private connect() {
    if (this.remote) return this.remote;
    const worker = new Worker(new URL('/workers/image.worker.js', window.location.origin), { type: 'module' });
    worker.addEventListener('error', () => {
      if (this.worker === worker) this.stop(new Error('The image worker stopped. Try again.'));
    });
    worker.addEventListener('messageerror', () => {
      if (this.worker === worker) this.stop(new Error('The image worker could not read the request. Try again.'));
    });
    this.worker = worker;
    this.remote = wrap<ImageWorkerApi>(worker);
    return this.remote;
  }

  async run<Result>(
    invoke: (worker: Remote<ImageWorkerApi>, progress: ProgressCallback) => Promise<Result>,
    onProgress: ProgressCallback,
  ): Promise<Result> {
    if (this.rejectJob) throw new Error('An image job is already running.');
    const worker = this.connect();
    let rejectJob!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectJob = reject; });
    this.rejectJob = rejectJob;
    try {
      return await Promise.race([invoke(worker, proxy(onProgress)), interrupted]);
    } finally {
      if (this.rejectJob === rejectJob) this.rejectJob = undefined;
    }
  }

  async renderDraft(request: Pick<ImageRequest, 'id' | 'commands'>) {
    if (!this.remote || this.rejectDraft) return;
    let rejectDraft!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectDraft = reject; });
    this.rejectDraft = rejectDraft;
    try {
      return await Promise.race([this.remote.renderDraft(request), interrupted]);
    } finally {
      if (this.rejectDraft === rejectDraft) this.rejectDraft = undefined;
    }
  }

  async renderComparison(request: ComparisonRequest) {
    if (!this.remote) return;
    let rejectComparison!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectComparison = reject; });
    this.rejectComparison?.(new DOMException('Comparison changed.', 'AbortError'));
    this.rejectComparison = rejectComparison;
    try {
      return await Promise.race([this.remote.renderComparison(request), interrupted]);
    } finally {
      if (this.rejectComparison === rejectComparison) this.rejectComparison = undefined;
    }
  }

  retainPreview(id: string) {
    void this.remote?.retainPreview(id);
  }

  releaseFullPreview() {
    return this.remote?.releaseFullPreview();
  }

  stop(reason: Error = new DOMException('Image processing canceled.', 'AbortError')) {
    this.rejectJob?.(reason);
    this.rejectJob = undefined;
    this.rejectDraft?.(reason);
    this.rejectDraft = undefined;
    this.rejectComparison?.(reason);
    this.rejectComparison = undefined;
    this.remote?.[releaseProxy]();
    this.worker?.terminate();
    this.worker = undefined;
    this.remote = undefined;
  }
}
