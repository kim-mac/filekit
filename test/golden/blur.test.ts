import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { env, InferenceSession } from 'onnxruntime-web/wasm';
import { beforeAll, expect, it } from 'vitest';
import { defaultBackground } from '../../lib/tools/image/background-options';
import { defaultBlur } from '../../lib/tools/image/blur-options';
import { defaultConvertOptions } from '../../lib/tools/image/formats';
import { decodeImage, encodeImage } from '../../lib/workers/image/codecs';
import { findYuNetFaces } from '../../lib/workers/image/faces';
import { exportImage, renderDraft, renderPreview } from '../../lib/workers/image/pipeline';
import { initializeWasm } from './wasm';

beforeAll(initializeWasm, 30_000);
const silent = () => {};
const load = (path: string) => readFile(new URL(path, import.meta.url));
const region = { kind: 'rectangle', bounds: { left: 0.25, top: 0, right: 0.75, bottom: 0.5 } } as const;
const blur = { toolId: 'blur', options: { ...defaultBlur, effect: 'pixelate', regions: [region] } };
const crop = { toolId: 'crop', options: {
  orientation: 6, bounds: { left: 0.25, top: 0.25, right: 1, bottom: 0.75 },
} };
const convert = { toolId: 'convert', options: defaultConvertOptions };

async function colorRamp() {
  const frame = new ImageData(8, 4);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) frame.data.set([x * 20 + y * 4, 0, 0, 255], (y * frame.width + x) * 4);
  }
  return new File([await encodeImage(frame, defaultConvertOptions)], 'ramp.png');
}

it.each([
  { order: 'before', commands: [blur, crop, convert], red: [48, 52, 52, 68, 52, 52, 88, 92, 92, 108, 92, 92] },
  { order: 'after', commands: [convert, crop, blur], red: [48, 56, 40, 68, 56, 60, 88, 84, 80, 108, 104, 100] },
])('renders exact preview and PNG pixels for blur $order crop and rotation', async ({ order, commands, red }) => {
  const request = { id: order, original: await colorRamp(), commands };
  await renderPreview({ ...request, commands: [] }, silent);
  const draft = await renderDraft(request);
  expect(draft).toMatchObject({ width: 3, height: 4 });
  expect([...draft!.data.filter((_, index) => index % 4 === 0)]).toEqual(red);
  for (const { blob } of [await renderPreview(request, silent), await exportImage(request, silent)]) {
    const { frame } = await decodeImage(blob);
    expect([frame.width, frame.height]).toEqual([3, 4]);
    expect([...frame.data.filter((_, index) => index % 4 === 0)]).toEqual(red);
  }
});

it('maps the same normalized blur to an EXIF-oriented source and its upright copy', async () => {
  const original = new File([new Uint8Array(await load('../fixtures/oriented.png'))], 'exif.png');
  const { frame } = await decodeImage(original);
  const normalized = new File([await encodeImage(frame, defaultConvertOptions)], 'upright.png');
  const commands = [blur, crop, convert];
  const result = await exportImage({ id: 'exif-blur', original, commands }, silent);
  const reference = await exportImage({ id: 'upright-blur', original: normalized, commands }, silent);
  const [a, b] = await Promise.all([decodeImage(result.blob), decodeImage(reference.blob)]);
  expect(a.frame.data).toEqual(b.frame.data);
});

it('replays blur on both sides of source-space background removal and retains the matte', async () => {
  const original = await colorRamp();
  const alpha = new Blob([new Uint8Array(32).map((_, index) => index % 2 === 0 ? 255 : 0)]);
  const background = { toolId: 'remove-background', options: {
    ...defaultBackground, mask: { id: 'stripe', alpha, width: 8, height: 4, tier: 'Lite', provider: 'wasm' },
  } };
  const first = await exportImage({ id: 'matte-after', original, commands: [blur, background] }, silent);
  const second = await exportImage({ id: 'matte-before', original, commands: [background, blur] }, silent);
  const [a, b] = await Promise.all([decodeImage(first.blob), decodeImage(second.blob)]);
  expect([...a.frame.data.slice(8, 12)]).toEqual([52, 0, 0, 255]);
  expect([...b.frame.data.slice(8, 12)]).toEqual([42, 0, 0, 255]);
  expect([...a.frame.data.filter((_, index) => index % 4 === 3)]).toEqual(
    [...b.frame.data.filter((_, index) => index % 4 === 3)],
  );
});

it('detects a face in the redistributable CC0 person-urban portrait', async () => {
  const weights = await load('../../public/face-models/yunet.onnx');
  expect(createHash('sha256').update(weights).digest('hex')).toBe(
    'be449cd884ae1bc17e089b78e132e80df959b88452f32c487c6fb0a8c8e27f14',
  );
  env.wasm.numThreads = 1;
  const session = await InferenceSession.create(new Uint8Array(weights), { executionProviders: ['wasm'] });
  try {
    const { frame } = await decodeImage(new Blob([new Uint8Array(await load('../fixtures/bg/person-urban.jpg'))]));
    const faces = await findYuNetFaces(frame, session);
    expect(faces).toHaveLength(1);
    const [face] = faces;
    expect(face.right - face.left).toBeGreaterThan(0.03);
    expect(face.bottom).toBeLessThan(0.6);
    expect(await findYuNetFaces(new ImageData(320, 320), session)).toEqual([]);
  } finally {
    await session.release();
  }
});

it('exports a full-resolution 6000×4000 Gaussian blur', async () => {
  const original = new File([new Uint8Array(await load('../fixtures/large-6000x4000.jpg'))], 'large.jpg');
  const commands = [{ toolId: 'blur', options: { ...defaultBlur, strength: 100, inverted: true } }];
  const { blob } = await exportImage({ id: 'full-res-blur', original, commands }, silent);
  const { frame } = await decodeImage(blob);
  expect([frame.width, frame.height]).toEqual([6000, 4000]);
}, 25_000);
