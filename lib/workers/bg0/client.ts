import { proxy, releaseProxy, wrap } from 'comlink';
import { isMobileDevice } from '../../core/device';
import type { ImageAIResults } from '../../tools/image/ai-results';
import type { ToolProgress } from '../../core/contracts';
import type { BackgroundWorkerApi, RemovalRequest } from './protocol';

const fullMarker = 'filekit-bg-full-in-progress';
const fullBlockedUntil = 'filekit-bg-lite-until';
const week = 7 * 24 * 60 * 60 * 1000;

function cachedFailure() {
  try {
    return Date.now() < Number(localStorage.getItem(fullBlockedUntil));
  } catch {
    return false;
  }
}

function marker() {
  try {
    return sessionStorage.getItem(fullMarker);
  } catch {
    return null;
  }
}

function setMarker(value?: string) {
  try {
    if (value) sessionStorage.setItem(fullMarker, value);
    else sessionStorage.removeItem(fullMarker);
  } catch {
    // Background removal remains available with storage disabled.
  }
}

function blockFull() {
  try {
    localStorage.setItem(fullBlockedUntil, String(Date.now() + week));
  } catch {
    // The current call can still use Lite.
  }
}

let busy = false;

export async function generateBackgroundMask(
  original: Blob, results: ImageAIResults, releaseImageMemory: () => Promise<void> | undefined,
  signal: AbortSignal, report: (update: ToolProgress) => void,
) {
  if (busy) throw new Error('Background removal is already in progress.');
  // A graceful navigation clears the marker. A reload after a killed Full
  // process uses Lite so the same tab does not keep crashing.
  if (marker()) {
    blockFull();
    setMarker();
  }
  const mobile = isMobileDevice();
  const request: RemovalRequest = {
    original, model: mobile || cachedFailure() ? 'lite' : 'auto', mobile, touchPoints: navigator.maxTouchPoints,
  };
  // The matte is computed from the immutable original. Background colors,
  // fill modes and later edits all use the same source-space result.
  const key = JSON.stringify(['bg0-0.1.2', request.model, request.mobile, request.touchPoints]);
  if (results.background?.key === key) return results.background.mask;
  busy = true;
  try {
    await releaseImageMemory();
    const mask = await runBackgroundWorker(request, signal, report);
    signal.throwIfAborted();
    results.background = { key, mask };
    return mask;
  } finally {
    busy = false;
  }
}

export async function runBackgroundWorker(request: RemovalRequest, signal: AbortSignal, report: (update: ToolProgress) => void) {
  signal.throwIfAborted();
  const worker = new Worker(new URL('/workers/background.worker.js', location.origin), { type: 'module' });
  const remote = wrap<BackgroundWorkerApi>(worker);
  let full = false;
  const interrupt = new AbortController();
  const activity = setInterval(() => {
    if (performance.now() - lastProgress > 300_000) {
      if (full) blockFull();
      interrupt.abort(new Error('Background removal stopped responding. Try again.'));
    }
  }, 5000);
  let lastProgress = performance.now();
  function clearMarker() {
    if (full) setMarker();
    full = false;
  }
  const pagehide = () => {
    clearMarker();
    interrupt.abort();
  };
  window.addEventListener('pagehide', pagehide, { once: true });
  const stopped = () => signal.aborted || interrupt.signal.aborted;
  let reject!: (reason: unknown) => void;
  const untilStopped = new Promise<never>((_, fail) => { reject = fail; });
  const abort = () => reject(signal.aborted ? signal.reason : interrupt.signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  interrupt.signal.addEventListener('abort', abort, { once: true });
  if (stopped()) abort();
  const fail = () => {
    if (full) blockFull();
    reject(new Error(full ? 'Full mode stopped. Try again in Lite mode.' : 'Background removal stopped. Try again.'));
  };
  worker.addEventListener('error', fail);
  worker.addEventListener('messageerror', fail);
  try {
    return await Promise.race([
      remote.makeMask(request, proxy(update => {
        lastProgress = performance.now();
        if (!request.bench && update.full !== undefined && update.full !== full) {
          clearMarker();
          full = update.full;
          if (full) setMarker(crypto.randomUUID());
        }
        if (!stopped()) report(update);
      })),
      untilStopped,
    ]);
  } finally {
    clearInterval(activity);
    clearMarker();
    signal.removeEventListener('abort', abort);
    interrupt.signal.removeEventListener('abort', abort);
    window.removeEventListener('pagehide', pagehide);
    remote[releaseProxy]();
    worker.terminate();
  }
}
