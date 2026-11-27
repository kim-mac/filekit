import { releaseProxy, wrap, type Remote } from 'comlink';
import { useEffect, useState } from 'react';
import { bmpBytes, formatBytes, type EstimateRequest } from '../../lib/tools/image/size-estimate';
import type { sizeEstimateApi } from '../../lib/workers/image/size-estimate.worker';

export class SizeEstimator {
  private worker?: Worker;
  private remote?: Remote<typeof sizeEstimateApi>;
  private cache = new WeakMap<Blob, { id: number; estimates: Map<string, Promise<number>> }>();
  private nextSample = 0;
  private reject = new Set<(error: Error) => void>();

  estimate(request: EstimateRequest, key: string) {
    if (request.output.format === 'bmp') return Promise.resolve(bmpBytes(request.size));

    let sample = this.cache.get(request.preview);
    if (!sample) {
      sample = { id: ++this.nextSample, estimates: new Map() };
      this.cache.set(request.preview, sample);
    }
    const { id, estimates } = sample;
    const cached = estimates.get(key);
    if (cached) return cached;
    const remote = this.connect();
    let reject!: (error: Error) => void;
    const interrupted = new Promise<never>((_, fail) => { reject = fail; });
    this.reject.add(reject);
    const result = Promise.race([remote.estimate({ ...request, sampleId: id }), interrupted])
      .catch(error => {
        estimates.delete(key);
        throw error;
      })
      .finally(() => this.reject.delete(reject));
    if (estimates.size >= 12) estimates.delete(estimates.keys().next().value!);
    estimates.set(key, result);
    return result;
  }

  private connect() {
    if (this.remote) return this.remote;
    const worker = new Worker('/workers/size-estimate.worker.js', { type: 'module' });
    const stop = () => { if (this.worker === worker) this.stop(); };
    worker.addEventListener('error', stop);
    worker.addEventListener('messageerror', stop);
    this.worker = worker;
    return this.remote = wrap<typeof sizeEstimateApi>(worker);
  }

  stop() {
    for (const reject of this.reject) reject(new Error('Size estimation stopped.'));
    this.reject.clear();
    this.remote?.[releaseProxy]();
    this.worker?.terminate();
    this.remote = this.worker = undefined;
  }
}

interface Props extends Omit<EstimateRequest, 'preview'> {
  readonly estimator: SizeEstimator;
  readonly preview?: Blob;
  readonly paused?: boolean;
}

export function OutputEstimate({ estimator, preview, output, size, crop, paused }: Props) {
  const key = JSON.stringify({ output, size: { width: size.width, height: size.height }, crop });
  const [estimate, setEstimate] = useState<{ preview: Blob; key: string; bytes?: number }>();
  useEffect(() => {
    if (!preview || paused) return;
    const sample = preview;
    let current = true;
    const timer = window.setTimeout(async () => {
      try {
        const bytes = await estimator.estimate({ preview: sample, ...JSON.parse(key) }, key);
        if (current) setEstimate({ preview: sample, key, bytes });
      } catch {
        if (current) setEstimate({ preview: sample, key });
      }
    }, 350);
    return () => { current = false; window.clearTimeout(timer); };
  }, [estimator, key, paused, preview]);
  const ready = estimate?.key === key && estimate.preview === preview;
  return <p className="output-estimate">Estimated output <strong aria-live="polite">
    {ready ? estimate.bytes === undefined ? 'Unavailable' : `≈ ${formatBytes(estimate.bytes)}`
      : paused || !preview ? '—' : 'Estimating…'}
  </strong></p>;
}
