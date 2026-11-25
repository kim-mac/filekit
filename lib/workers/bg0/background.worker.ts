import { expose, releaseProxy, type Remote } from 'comlink';
import { MODEL_TIER_BYTES, prepareBackgroundRemoval, removeBackground, type RemovalProgress } from '@bg0/browser';
import { decodeImage, encodeImage } from '../image/codecs';
import { flatten, resizePreview } from '../image/pixels';
import { defaultConvertOptions } from '../../tools/image/formats';
import type { BackgroundWorkerApi, RemovalRequest, RemovalUpdate } from './protocol';
import { assetResponse } from './asset-stream.mjs';

const modelRoot = '/bg-model-source/';
const iosModelBytes = 55_563_408;
const mib = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;

function isIos(touchPoints: number) {
  return /iPhone|iPod|iPad/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && touchPoints > 1);
}

async function configure(request: Omit<RemovalRequest, 'original'>, ios: boolean, report: (update: RemovalUpdate) => void) {
  // WorkerNavigator omits the touch hint used for desktop-mode iPads.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: request.touchPoints });
  if (request.forceWasm) Object.defineProperty(navigator, 'gpu', { value: undefined });
  if (ios) return;
  const { env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = location.origin + modelRoot;
  env.remotePathTemplate = '{model}/resolve/{revision}/';
  env.fetch = (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== location.origin || req.method !== 'GET' || req.body) {
      return Promise.reject(new Error('Background removal requires same-origin static GET requests.'));
    }
    if (url.pathname.startsWith(modelRoot) && url.pathname.endsWith('/onnx/model_fp16.onnx')) {
      return assetResponse(`${url.pathname}.json`, req.signal);
    }
    return fetch(req, { redirect: 'error' });
  };
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    const current = wasm.wasmPaths;
    const basename = typeof current === 'object' && String(current.mjs).endsWith('.asyncify.mjs')
      ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';
    const runtime = new URL('/bg-runtime/onnx/', location.origin).href;
    env.useWasmCache = false;
    if (basename.endsWith('.asyncify')) {
      report({ message: 'Preparing the local inference runtime…', progress: 0.02 });
      wasm.wasmBinary = new Uint8Array(await (await assetResponse(`${runtime}${basename}.wasm.json`)).arrayBuffer());
    }
    wasm.wasmPaths = { mjs: `${runtime}${basename}.mjs`, wasm: `${runtime}${basename}.wasm` };
    wasm.numThreads = 1;
    wasm.proxy = false;
  }
}

async function inferenceInput(original: Blob, edge: number) {
  const { frame } = await decodeImage(original);
  return encodeImage(flatten(resizePreview(frame, edge), '#ffffff'), defaultConvertOptions);
}

function progress(update: RemovalProgress, ios: boolean): RemovalUpdate {
  const tier = update.model === 'birefnet' ? 'Full' : update.model ? 'Lite' : undefined;
  const bytes = ios ? iosModelBytes : tier === 'Full' ? MODEL_TIER_BYTES.full : MODEL_TIER_BYTES.lite;
  const detail = update.stage === 'downloading'
    ? update.download ? ` · ${mib(Math.min(bytes, update.download.loadedBytes))} / ${mib(bytes)}`
      : ` · Model ${mib(bytes)}`
    : '';
  return {
    message: `${tier ? `${tier} · ` : ''}${update.message}${detail}`,
    progress: update.progress,
    full: tier === undefined ? undefined : tier === 'Full',
  };
}

let configuration: Promise<void> | undefined;
const api: BackgroundWorkerApi = {
  async prepare(request) {
    configuration ??= configure(request, isIos(request.touchPoints), () => undefined);
    await configuration;
    return prepareBackgroundRemoval({ model: request.model });
  },
  async makeMask(request, report) {
    try {
      const ios = isIos(request.touchPoints);
      configuration ??= configure(request, ios, report);
      await configuration;
      const input = await inferenceInput(request.original, ios ? 1280 : request.mobile ? 1024 : 1600);
      const result = await removeBackground(input, {
        model: request.model,
        quality: request.mobile ? 'fast' : 'quality',
        onProgress: update => report(progress(update, ios)),
      });
      const { frame } = await decodeImage(result.blob);
      const alpha = new Uint8Array(frame.width * frame.height);
      for (let index = 0; index < alpha.length; index++) alpha[index] = frame.data[4 * index + 3];
      return {
        id: crypto.randomUUID(), alpha: new Blob([alpha]), width: frame.width, height: frame.height,
        tier: result.model === 'birefnet' ? 'Full' : 'Lite', provider: result.provider,
        outputMaxEdge: ios ? 1280 : undefined,
      };
    } finally {
      (report as unknown as Remote<(update: RemovalUpdate) => void>)[releaseProxy]();
    }
  },
};
expose(api);
