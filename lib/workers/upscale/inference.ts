import { isMemoryError, memoryRecovery } from '../../core/processing-error';
import type { ModelDownload } from '../../core/contracts';
/// <reference types="@webgpu/types" />

import { wasmThreads } from '../wasm-threads.mjs';
import type { InferenceSession } from 'onnxruntime-web';
import type { UpscaleOptions, UpscaleQuality } from '../../tools/image/upscale-options';
import { upscaleLimitError, upscaleSize } from '../../tools/image/upscale-options';
import { assetResponse } from '../bg0/asset-stream.mjs';
import models from './models.json';
import { upscaleTiles, type TileInput } from './tiles';

type Ort = typeof import('onnxruntime-web');
type Provider = UpscaleQuality['provider'];
type Model = keyof typeof models;
type Report = (stage: string, detail?: { done: number; total: number }, download?: ModelDownload) => void;
type Engine = { model: Model; provider: Provider; ort: Ort; session: InferenceSession };

const modelRoot = '/upscale-models';
const runtimeRoot = '/bg-runtime/onnx/';

let engine: Engine | undefined;
let gpuAdapter: Promise<GPUAdapter | undefined> | undefined;
let webgpuFailed = false;
let webgpuBinary: ArrayBuffer | undefined;

async function loadWeights(model: Model, report: Report) {
  try {
    const expected = models[model];
    const response = await assetResponse(`${modelRoot}/${model}.json`, undefined, { root: modelRoot, ...expected },
      (loaded, total, id) => report('Downloading upscale model', undefined, { id, loaded, total }));
    const bytes = await response.arrayBuffer();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== expected.sha256) throw new Error('Upscale model failed SHA-256 verification.');
    return bytes;
  } catch (cause) {
    if (isMemoryError(cause)) throw new Error(memoryRecovery);
    throw new Error('Could not download or verify the Upscale model. Check your connection and try again.', { cause });
  }
}

async function closeEngine() {
  const old = engine;
  engine = undefined;
  await old?.session.release().catch(() => undefined);
}

async function openEngine(model: Model, provider: Provider, weights: ArrayBuffer, mobile: boolean, adapter?: GPUAdapter) {
  const ort: Ort = provider === 'webgpu'
    ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
  const stem = provider === 'webgpu' ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';
  const base = new URL(runtimeRoot, location.origin).href;
  ort.env.wasm.numThreads = wasmThreads(mobile);
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { mjs: `${base}${stem}.mjs`, wasm: `${base}${stem}.wasm` };
  if (provider === 'webgpu') {
    if (!adapter) throw new Error('WebGPU adapter unavailable.');
    ort.env.webgpu.adapter = adapter;
    webgpuBinary ??= await (await assetResponse(`${runtimeRoot}${stem}.wasm.json`)).arrayBuffer();
    ort.env.wasm.wasmBinary = webgpuBinary;
  }
  const session = await ort.InferenceSession.create(weights, {
    executionProviders: provider === 'webgpu' ? [{ name: 'webgpu', preferredLayout: 'NHWC' }, 'wasm'] : ['wasm'],
    enableCpuMemArena: false,
    enableMemPattern: false,
  });
  return { model, provider, ort, session };
}

async function predict({ session, ort }: Engine, { data, width, height }: TileInput) {
  const input = new ort.Tensor('float32', data, [1, 3, height, width]);
  try {
    const { output } = await session.run({ input });
    try {
      if (output.dims.join() !== `1,3,${height * 4},${width * 4}`) throw new Error('Invalid upscale output dimensions.');
      const pixels = await output.getData();
      if (!(pixels instanceof Float32Array)) throw new Error('Invalid upscale output type.');
      return pixels;
    } finally {
      output.dispose();
    }
  } finally {
    input.dispose();
  }
}

async function hardwareAdapter() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (adapter && !adapter.info.isFallbackAdapter) return adapter;
}

export async function runUpscale(frame: ImageData, options: UpscaleOptions, report: Report) {
  const error = upscaleLimitError(upscaleSize(frame, options.scale), options.mobile);
  if (error) throw new Error(error);
  const model = options.mode === 'photo' ? 'general' : 'anime';
  const { label, halo } = models[model];
  let adapter: GPUAdapter | undefined;
  if (!options.mobile && !webgpuFailed) {
    gpuAdapter ??= hardwareAdapter().catch(() => undefined);
    adapter = await gpuAdapter;
  }
  let weights: ArrayBuffer | undefined;
  async function run(provider: Provider) {
    if (engine?.provider !== provider || engine.model !== model) {
      await closeEngine();
      report(`Loading ${label} weights`);
      weights ??= await loadWeights(model, report);
      report(`Starting ${provider === 'wasm' ? 'WASM' : 'WebGPU'}`);
      engine = await openEngine(model, provider, weights, options.mobile, adapter);
    }
    const active = engine;
    const core = options.mobile ? 112 : provider === 'wasm' ? 256 : 288;
    const quality: UpscaleQuality = { model: label, provider };
    const pixels = await upscaleTiles(frame, options.scale, { core, overlap: 8, halo },
      input => predict(active, input), (done, total) => report(
        `${label} · ${provider === 'wasm' ? 'WASM' : 'WebGPU'}`, { done, total },
      ));
    return { frame: pixels, quality };
  }
  if (adapter) {
    // Verify weights before the fallback block so integrity errors get surfaced.
    if (engine?.model !== model || engine.provider !== 'webgpu') {
      report(`Loading ${label} weights`);
      weights = await loadWeights(model, report);
    }
    try {
      return await run('webgpu');
    } catch {
      webgpuFailed = true;
      await closeEngine();
      report('WebGPU unavailable. Switching to WASM');
    }
  }
  try {
    return await run('wasm');
  } catch (cause) {
    await closeEngine();
    if (isMemoryError(cause)) throw new Error(memoryRecovery);
    if (cause instanceof Error && cause.message.startsWith('Could not download or verify')) throw cause;
    throw new Error('Upscaling could not finish. Try a smaller crop or scale.', { cause });
  }
}
