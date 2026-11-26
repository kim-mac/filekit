// Shared memory is only exposed in an isolated browser context. Leave extra
// cores available to the UI and limit the memory used by mobile worker pools.
export function wasmThreads(mobile = /Android|iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent ?? ''),
  cores = globalThis.navigator?.hardwareConcurrency, isolated = globalThis.crossOriginIsolated) {
  return isolated && typeof SharedArrayBuffer === 'function'
    ? Math.max(1, Math.min(cores || 1, mobile ? 2 : 8))
    : 1;
}
