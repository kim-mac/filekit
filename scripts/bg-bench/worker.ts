/// <reference types="@webgpu/types" />
import { expose } from 'comlink';
import type { InferenceSession } from 'onnxruntime-web';
import type { Backend, BenchWorker, Model } from './protocol';
import { decontaminate, guidedAlpha } from './refine';
import { canvas, gray, makeRow, makeVariant, maskImage } from './render';

type Ort = typeof import('onnxruntime-web');
type WeightManifest = { bytes: number; sha256: string; chunks: { name: string; bytes: number; sha256: string }[] };

async function get(path: string) {
  const response = await fetch(path, { cache: 'no-store', mode: 'same-origin' });
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${path}`);
  return response;
}

async function digest(data: ArrayBuffer) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loadWeights(model: Model) {
  const prefix = `/dev/bg-bench/weights/${model.sha256}/`;
  const manifest: WeightManifest = await (await get(`${prefix}manifest.json`)).json();
  if (manifest.bytes !== model.bytes || manifest.sha256 !== model.sha256) throw new Error('Unexpected weight manifest');

  const weights = new Uint8Array(model.bytes);
  let offset = 0;
  for (const [index, chunk] of manifest.chunks.entries()) {
    if (chunk.name !== `${index}.bin`) throw new Error('Unexpected chunk name');
    const data = await (await get(prefix + chunk.name)).arrayBuffer();
    if (data.byteLength !== chunk.bytes || await digest(data) !== chunk.sha256) throw new Error('Invalid weight chunk');
    weights.set(new Uint8Array(data), offset);
    offset += chunk.bytes;
  }
  if (offset !== model.bytes || await digest(weights.buffer) !== model.sha256) throw new Error('Invalid model digest');
  return weights;
}

function inputPixels(model: Model, bitmap: ImageBitmap) {
  const width = model.id === 'modnet'
    ? Math.max(32, Math.floor(model.size * bitmap.width / Math.max(bitmap.width, bitmap.height) / 32) * 32)
    : model.size;
  const height = model.id === 'modnet'
    ? Math.max(32, Math.floor(model.size * bitmap.height / Math.max(bitmap.width, bitmap.height) / 32) * 32)
    : model.size;
  const { ctx } = canvas(width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const length = width * height;
  let divisor = 255;
  if (model.imageMax) {
    divisor = 1;
    for (let i = 0; i < data.length; i += 4) divisor = Math.max(divisor, data[i], data[i + 1], data[i + 2]);
  }
  const input = new Float32Array(length * 3);
  const means = model.normalization === 'imagenet' ? [0.485, 0.456, 0.406] : [0.5, 0.5, 0.5];
  const std = {
    imagenet: [0.229, 0.224, 0.225], centered: [1, 1, 1], signed: [0.5, 0.5, 0.5],
  }[model.normalization];
  if (!std) throw new Error('Unknown normalization');
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < length; i++) {
      input[channel * length + i] = (data[4 * i + channel] / divisor - means[channel]) / std[channel];
    }
  }
  return { input, width, height };
}

function resizeAlpha(
  data: Float32Array, model: Model, sourceWidth: number, sourceHeight: number, width: number, height: number,
) {
  const values = model.outputTransform.startsWith('sigmoid')
    ? data.map(value => 1 / (1 + Math.exp(-value))) : data;
  if (values.some(value => !Number.isFinite(value))) throw new Error('Non-finite model output');
  let min = 0;
  let max = 1;
  if (model.outputTransform.endsWith('minmax')) {
    min = Infinity;
    max = -Infinity;
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const alpha = Uint8Array.from(values, value => Math.round(255 * Math.max(0, Math.min(1, (value - min) / (max - min || 1)))));
  const source = canvas(sourceWidth, sourceHeight);
  source.ctx.putImageData(maskImage(alpha, sourceWidth, sourceHeight), 0, 0);
  const output = canvas(width, height);
  output.ctx.drawImage(source.image, 0, 0, width, height);
  return gray(output.ctx.getImageData(0, 0, width, height));
}

async function imageBitmap(buffer: ArrayBuffer) {
  return createImageBitmap(new Blob([buffer]));
}

let active: { model: Model; session: InferenceSession; ort: Ort } | undefined;

async function load(model: Model, backend: Backend, requireHardware = false) {
  if (active) throw new Error('Close the previous model first');
  const start = performance.now();
  // Select the EP explicitly. ORT can still partition unsupported WebGPU operators to CPU.
  const ort: Ort = backend === 'webgpu'
    ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
  let adapter = null;
  if (backend === 'webgpu') {
    const gpu = await navigator.gpu?.requestAdapter();
    if (!gpu) throw new Error('WebGPU adapter unavailable in worker');
    const { vendor, architecture, device, description, isFallbackAdapter } = gpu.info;
    if (requireHardware && isFallbackAdapter) throw new Error('Hardware WebGPU adapter unavailable');
    ort.env.webgpu.adapter = gpu;
    adapter = { vendor, architecture, device, description, software: isFallbackAdapter };
  }
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const assets = new URL('/dev/bg-bench/ort/', location.href).href;
  const stem = backend === 'webgpu' ? 'ort-wasm-simd-threaded.asyncify' : 'ort-wasm-simd-threaded';
  ort.env.wasm.wasmPaths = { mjs: `${assets}${stem}.mjs`, wasm: `${assets}${stem}.wasm` };

  const weightsStart = performance.now();
  const weights = await loadWeights(model);
  const sessionStart = performance.now();
  const executionProviders: InferenceSession.ExecutionProviderConfig[] = backend === 'webgpu'
    ? [{ name: 'webgpu', preferredLayout: 'NHWC' }] : ['wasm'];
  const session = await ort.InferenceSession.create(weights, { executionProviders });
  const end = performance.now();
  active = { model, session, ort };
  return { weightsMs: sessionStart - weightsStart, sessionMs: end - sessionStart, loadMs: end - start, adapter };
}

async function predict(buffer: ArrayBuffer, truthBuffer: ArrayBuffer | null, label: string, repeats: number, refine: boolean) {
  if (!active) throw new Error('Load a model first');
  const { model, session, ort } = active;
  const bitmap = await imageBitmap(buffer);
  let original: ImageData;
  let tensor: InstanceType<Ort['Tensor']>;
  try {
    const { width, height } = bitmap;
    const { ctx } = canvas(width, height);
    ctx.drawImage(bitmap, 0, 0);
    original = ctx.getImageData(0, 0, width, height);
    const input = inputPixels(model, bitmap);
    tensor = new ort.Tensor('float32', input.input, [1, 3, input.height, input.width]);
  } finally {
    bitmap.close();
  }

  const timingsMs: number[] = [];
  let alpha: Uint8Array | undefined;
  try {
    for (let run = 0; run < repeats; run++) {
      const start = performance.now();
      const result = (await session.run({ [model.input]: tensor }, [model.output]))[model.output];
      try {
        const data = await result.getData();
        timingsMs.push(performance.now() - start);
        if (!(data instanceof Float32Array)) throw new Error('Unexpected ONNX output type');
        if (run === repeats - 1) {
          const [, , height, width] = result.dims;
          alpha = resizeAlpha(data, model, width, height, original.width, original.height);
        }
      } finally {
        result.dispose();
      }
    }
  } finally {
    tensor.dispose();
  }
  if (!alpha) throw new Error('No model output');

  let truth = null;
  if (truthBuffer) {
    const bitmap = await imageBitmap(truthBuffer);
    try {
      if (bitmap.width !== original.width || bitmap.height !== original.height) throw new Error('Truth dimensions differ');
      const { ctx } = canvas(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      truth = gray(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
    } finally {
      bitmap.close();
    }
  }

  const baseline = await makeVariant(original, alpha, truth, label);
  if (!refine) return { timingsMs, baseline, guided: null, decontaminatedRow: null, refinementMs: null };

  const start = performance.now();
  const guidedMask = guidedAlpha(original, alpha);
  const guidedEnd = performance.now();
  const cleaned = decontaminate(original, guidedMask);
  const end = performance.now();
  const guided = await makeVariant(original, guidedMask, truth, `${label} · guided`);
  const decontaminatedRow = await makeRow(
    original, maskImage(guidedMask, original.width, original.height), guidedMask, cleaned,
    `${label} · guided + color decontamination`,
  );
  return { timingsMs, baseline, guided, decontaminatedRow,
    refinementMs: { guided: guidedEnd - start, decontamination: end - guidedEnd } };
}

async function compare(
  image: ArrayBuffer, truthBuffer: ArrayBuffer | null, label: string,
  alpha: ArrayBuffer, width: number, height: number,
) {
  const bitmap = await imageBitmap(image);
  const original = canvas(bitmap.width, bitmap.height);
  original.ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = original.ctx.getImageData(0, 0, original.image.width, original.image.height);
  const source = canvas(width, height);
  source.ctx.putImageData(maskImage(new Uint8Array(alpha), width, height), 0, 0);
  original.ctx.drawImage(source.image, 0, 0, pixels.width, pixels.height);
  const resized = gray(original.ctx.getImageData(0, 0, pixels.width, pixels.height));
  let truth = null;
  if (truthBuffer) {
    const reference = await imageBitmap(truthBuffer);
    try {
      original.ctx.drawImage(reference, 0, 0);
      truth = gray(original.ctx.getImageData(0, 0, pixels.width, pixels.height));
    } finally {
      reference.close();
    }
  }
  return makeVariant(pixels, resized, truth, label);
}

expose({
  load,
  predict,
  compare,
  async close() {
    await active?.session.release();
    active = undefined;
  },
} satisfies BenchWorker);
