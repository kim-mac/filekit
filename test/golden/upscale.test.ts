import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import { beforeAll, expect, it, vi } from 'vitest';
import { defaultBackground } from '../../lib/tools/image/background-options';
import { defaultBlur } from '../../lib/tools/image/blur-options';
import { defaultConvertOptions } from '../../lib/tools/image/formats';
import { fullBounds } from '../../lib/tools/image/geometry';
import { upscaleLimitError, upscaleSize, type UpscaleOptions } from '../../lib/tools/image/upscale-options';
import { decodeImage, encodeImage } from '../../lib/workers/image/codecs';
import { exportImage, renderDraft, renderPreview } from '../../lib/workers/image/pipeline';
import models from '../../lib/workers/upscale/models.json';
import { upscaleTiles, tileInput } from '../../lib/workers/upscale/tiles';
import { initializeWasm } from './wasm';

const sessions = new Map<keyof typeof models, Promise<InferenceSession>>();
const silent = () => {};
beforeAll(initializeWasm, 30_000);

async function session(model: keyof typeof models) {
  const cached = sessions.get(model);
  if (cached) return cached;
  const load = (async () => {
    const { bytes, sha256 } = models[model];
    const data = await readFile(new URL(`../../public/upscale-models/chunks/${sha256}/0.bin`, import.meta.url));
    expect(data.byteLength).toBe(bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(sha256);
    env.wasm.numThreads = 1;
    return InferenceSession.create(new Uint8Array(data), { executionProviders: ['wasm'] });
  })();
  sessions.set(model, load);
  return load;
}

async function infer(model: keyof typeof models, { data, width, height }: ReturnType<typeof tileInput>) {
  const input = new Tensor('float32', data, [1, 3, height, width]);
  const { output } = await (await session(model)).run({ input });
  const pixels = (await output.getData() as Float32Array).slice();
  input.dispose();
  output.dispose();
  return pixels;
}

// Browser transport is exercised in Playwright. Use the same weights,
// ONNX Runtime WASM engine and production compositor with local assets here.
vi.mock('../../lib/workers/upscale/inference', () => ({
  async runUpscale(frame: ImageData, options: UpscaleOptions) {
    const error = upscaleLimitError(upscaleSize(frame, options.scale), options.mobile);
    if (error) throw new Error(error);
    const model = options.mode === 'photo' ? 'general' : 'anime';
    return {
      frame: await upscaleTiles(frame, options.scale, { core: 256, overlap: 8, halo: models[model].halo },
        input => infer(model, input), silent),
      quality: { model: models[model].label, provider: 'wasm' },
    };
  },
}));

function pattern(width: number, height: number) {
  const frame = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      frame.data.set([x * 5 % 256, y * 13 % 256, (x + y) * 7 % 256, x < 10 ? 100 : 255], (y * width + x) * 4);
    }
  }
  return frame;
}

it.each(['general', 'anime'] as const)('matches single-pass %s output at seams within 1/255 per channel', async model => {
  const frame = pattern(63, 53);
  const run = (core: number) => upscaleTiles(frame, 4, { core, overlap: 4, halo: models[model].halo },
    input => infer(model, input), silent);
  const reference = await run(128);
  const tiled = await run(31);
  let max = 0;
  let sum = 0;
  for (let i = 0; i < tiled.data.length; i++) {
    const error = Math.abs(tiled.data[i] - reference.data[i]);
    max = Math.max(max, error);
    sum += error;
  }
  expect(max).toBeLessThanOrEqual(1);
  expect(sum / tiled.data.length).toBeLessThan(0.03);
}, 25_000);

const cropAndRotate = { toolId: 'crop', options: { orientation: 6,
  bounds: { left: 0, top: 0, right: 1, bottom: 0.5 },
} };
const rotateAgain = { toolId: 'crop', options: { orientation: 8, bounds: fullBounds } };
const convert = { toolId: 'convert', options: { ...defaultConvertOptions, format: 'webp', quality: 100 } };
const upscale = (scale: 2 | 4) => ({ toolId: 'upscale', options: { scale, mode: 'art', mobile: false } });

it.each([2, 4] as const)('exports exact dimensions after crop and rotation around a %sx upscale', async scale => {
  const original = new File([await encodeImage(pattern(13, 9), defaultConvertOptions)], 'odd.png');
  const request = { id: `odd-${scale}`, original, commands: [convert, cropAndRotate, upscale(scale), rotateAgain] };
  expect((await renderPreview(request, silent)).info).toMatchObject({ width: 7 * scale, height: 9 * scale });
  const { blob } = await exportImage(request, silent);
  expect(blob.type).toBe('image/webp');
  expect((await decodeImage(blob)).frame).toMatchObject({ width: 7 * scale, height: 9 * scale });
});

it('uses only the full-resolution cropped raster as the model input', async () => {
  const original = new File([await encodeImage(pattern(31, 27), defaultConvertOptions)], 'before.png');
  const cropped = await exportImage({ id: 'crop-first', original, commands: [cropAndRotate] }, silent);
  const a = await exportImage({ id: 'with-crop', original, commands: [cropAndRotate, upscale(4)] }, silent);
  const b = await exportImage({
    id: 'pre-cropped', original: new File([cropped.blob], 'cropped.png'), commands: [upscale(4)],
  }, silent);
  expect(await a.blob.arrayBuffer()).toEqual(await b.blob.arrayBuffer());
});

it('projects a source-space matte after crop and upscale, with working blur drafts', async () => {
  const size = { width: 24, height: 20 };
  const original = new File([await encodeImage(pattern(size.width, size.height), defaultConvertOptions)], 'matte.png');
  const alpha = new Uint8Array(size.width * size.height).map((_, i) => i % size.width < 6 ? 0 : 255);
  const background = { toolId: 'remove-background', options: {
    ...defaultBackground, mask: { ...size, id: 'split', alpha: new Blob([alpha]), tier: 'Lite', provider: 'wasm' },
  } };
  const blur = { toolId: 'blur', options: { ...defaultBlur, inverted: true, effect: 'pixelate', blockSize: 100 } };
  for (const commands of [[cropAndRotate, upscale(4), blur, background], [blur, background, cropAndRotate, upscale(4)]]) {
    const request = { id: String(commands[0].toolId), original, commands };
    const preview = await renderPreview(request, silent);
    expect(preview.info).toMatchObject({ width: 80, height: 48, hasAlpha: true });
    expect(await renderDraft({ ...request, commands: [...commands, blur] })).toMatchObject({ width: 80, height: 48 });
    const { frame } = await decodeImage((await exportImage(request, silent)).blob);
    const at = (y: number) => frame.data[(y * frame.width + 40) * 4 + 3];
    expect(at(0)).toBe(0);
    expect(at(47)).toBe(255);
  }
});
