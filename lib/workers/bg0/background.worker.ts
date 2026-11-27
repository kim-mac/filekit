import { wasmThreads } from '../wasm-threads.mjs';
import { expose, releaseProxy, type Remote } from 'comlink';
import { prepareBackgroundRemoval, removeBackground, type RemovalProgress } from '@bg0/browser';
import { decodeImage, encodeImage } from '../image/codecs';
import { flatten, resizePreview } from '../image/pixels';
import { defaultConvertOptions } from '../../tools/image/formats';
import type { BackgroundWorkerApi, RemovalRequest, RemovalUpdate } from './protocol';
import { assetResponse } from './asset-stream.mjs';

const modelRoot = '/bg-model-source/';
const iosModelBytes = 55_563_408;

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
      return assetResponse(`${url.pathname}.json`, req.signal, undefined, (loaded, total, id) => {
        report({ message: 'Downloading background removal model', download: { id, loaded, total } });
      });
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
    wasm.numThreads = wasmThreads(request.mobile);
    wasm.proxy = false;
  }
}

async function inferenceInput(original: Blob, edge: number) {
  const { frame } = await decodeImage(original);
  return encodeImage(flatten(resizePreview(frame, edge), '#ffffff'), defaultConvertOptions);
}

function progress(update: RemovalProgress, ios: boolean): RemovalUpdate {
  const tier = update.model === 'birefnet' ? 'Full' : update.model ? 'Lite' : undefined;
  const downloading = ios && update.stage === 'downloading';
  return {
    message: update.stage === 'downloading' && !ios ? 'Preparing background removal…' : update.message,
    progress: update.progress,
    full: tier === undefined ? undefined : tier === 'Full',
    download: downloading ? {
      id: 'background-ios-lite', total: iosModelBytes,
      loaded: Math.round(iosModelBytes * Math.max(0, Math.min(1, (update.progress - 0.08) / 0.5))),
    } : undefined,
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
