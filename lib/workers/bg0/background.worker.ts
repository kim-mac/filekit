import { wasmThreads } from '../wasm-threads.mjs';
import { expose, releaseProxy, type Remote } from 'comlink';
import { getAutoModel, isIosBrowser, prepareBackgroundRemoval, removeBackground, type RemovalProgress } from '@bg0/browser';
import { decodeImage, encodeImage } from '../image/codecs';
import { flatten, resizePreview } from '../image/pixels';
import { defaultConvertOptions } from '../../tools/image/formats';
import type { ModelDownload } from '../../core/contracts';
import type { BackgroundWorkerApi, RemovalRequest, RemovalUpdate } from './protocol';
import { assetResponse } from './asset-stream.mjs';

const modelRoot = '/bg-model-source/';
const preparing = { message: 'Preparing image', step: 1, totalSteps: 3 } as const;

function setTouchPoints(touchPoints: number) {
  // WorkerNavigator omits the touch hint used for desktop-mode iPads.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

async function configure(request: Omit<RemovalRequest, 'original'>, ios: boolean, report: (download: ModelDownload) => void) {
  setTouchPoints(request.touchPoints);
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
      return assetResponse(`${url.pathname}.json`, req.signal, undefined, (loaded, total, id, received) => {
        report({ id, loaded, total, received });
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

function progress(update: RemovalProgress): RemovalUpdate {
  const full = update.model === undefined ? undefined : update.model === 'birefnet';
  const refining = update.stage === 'finishing' || update.message.startsWith('Refining');
  if (refining) return { message: 'Refining edges', step: 3, totalSteps: 3, full };
  if (update.stage === 'processing') return { message: 'Finding the subject', step: 2, totalSteps: 3, full };
  return { ...preparing, full };
}

let configuration: Promise<void> | undefined;
const api: BackgroundWorkerApi = {
  async autoModel(touchPoints) {
    setTouchPoints(touchPoints);
    return getAutoModel();
  },
  async prepare(request) {
    configuration ??= configure(request, isIosBrowser(navigator.userAgent, request.touchPoints), () => undefined);
    await configuration;
    return prepareBackgroundRemoval({ model: request.model });
  },
  async makeMask(request, report) {
    try {
      const ios = isIosBrowser(navigator.userAgent, request.touchPoints);
      let download: ModelDownload | undefined;
      let attemptedFull = false;
      let tier: boolean | undefined;
      let current: RemovalUpdate = preparing;
      report(current);
      configuration ??= configure(request, ios, update => {
        download = update.loaded < update.total ? update : undefined;
        report({ ...current, download });
      });
      await configuration;
      const input = await inferenceInput(request.original, ios ? 1280 : request.mobile ? 1024 : 1600);
      const result = await removeBackground(input, {
        model: request.model,
        quality: request.mobile ? 'fast' : 'quality',
        onProgress: update => {
          current = progress(update);
          if (current.full !== undefined) {
            if (tier !== undefined && tier !== current.full) download = undefined;
            tier = current.full;
            attemptedFull ||= current.full;
          }
          if (current.step > 1) download = undefined;
          if (ios && update.download) {
            const { loadedBytes, totalBytes, receivedBytes } = update.download;
            download = loadedBytes < totalBytes ? {
              id: 'background-ios-lite', loaded: loadedBytes, total: totalBytes, received: receivedBytes,
            } : undefined;
          }
          report({ ...current, download });
        },
      });
      const { frame } = await decodeImage(result.blob);
      const alpha = new Uint8Array(frame.width * frame.height);
      for (let index = 0; index < alpha.length; index++) alpha[index] = frame.data[4 * index + 3];
      return {
        id: crypto.randomUUID(), alpha: new Blob([alpha]), width: frame.width, height: frame.height,
        tier: result.model === 'birefnet' ? 'Full' : 'Lite', provider: result.provider,
        fellBack: result.model !== 'birefnet' && (attemptedFull || request.model === 'full'),
        outputMaxEdge: ios ? 1280 : undefined,
      };
    } finally {
      (report as unknown as Remote<(update: RemovalUpdate) => void>)[releaseProxy]();
    }
  },
};
expose(api);
