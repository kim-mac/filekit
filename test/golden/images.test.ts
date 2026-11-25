import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConvertOptions, outputFormats, type OutputFormat } from '../../lib/tools/image/formats';
import { fullBounds, fullGeometry, type Bounds, type Orientation } from '../../lib/tools/image/geometry';
import { decodeImage } from '../../lib/workers/image/codecs';
import { compositeBackground } from '../../lib/workers/image/background';
import { detectFormat } from '../../lib/workers/image/headers';
import { exportImage, exportZip, renderPreview } from '../../lib/workers/image/pipeline';
import { orient, renderGeometry } from '../../lib/workers/image/pixels';
import { initializeWasm } from './wasm';

const silent = () => {};
const convert = (format: OutputFormat, quality = 85, background = '#ffffff') => (
  { toolId: 'convert', options: { ...defaultConvertOptions, format, quality, background } }
);
const crop = (orientation: Orientation, bounds: Bounds = fullBounds) => ({ toolId: 'crop', options: { bounds, orientation } });
const fixture = async (name: string) => new File(
  [new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)))], name,
);
const rgba = (frame: ImageData, x: number, y: number) => (
  [...frame.data.slice((y * frame.width + x) * 4, (y * frame.width + x + 1) * 4)]
);

function near(actual: number[], expected: number[], tolerance: number) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(tolerance));
}

beforeAll(initializeWasm, 30_000);

describe('WASM input goldens', () => {
  it.each([
    ['oriented.jpg', 'jpeg', 64, 96, [39, 107, 214]],
    ['oriented.png', 'png', 64, 96, [39, 107, 214]],
    ['oriented.webp', 'webp', 64, 96, [39, 107, 214]],
    ['container-oriented.heic', 'heic', 64, 96, [39, 107, 214]],
    ['oriented.heic', 'heic', 64, 96, [39, 107, 214]],
    ['reference.heic', 'heic', 96, 64, [230, 65, 46]],
    ['reference.avif', 'avif', 96, 64, [230, 65, 46]],
    ['reference.webp', 'webp', 96, 64, [230, 65, 46]],
    ['animated.gif', 'gif', 96, 64, [230, 65, 46]],
    ['animated.webp', 'webp', 96, 64, [230, 65, 46]],
  ] as const)('decodes %s with the expected first frame and orientation', async (name, kind, width, height, pixel) => {
    const { frame, format } = await decodeImage(await fixture(name));
    expect(format).toBe(kind);
    expect([frame.width, frame.height]).toEqual([width, height]);
    near(rgba(frame, 12, 12), [...pixel, 255], 15);
  });

  it.each([
    [1, [1, 2, 3, 4, 5, 6]],
    [2, [3, 2, 1, 6, 5, 4]],
    [3, [6, 5, 4, 3, 2, 1]],
    [4, [4, 5, 6, 1, 2, 3]],
    [5, [1, 4, 2, 5, 3, 6]],
    [6, [4, 1, 5, 2, 6, 3]],
    [7, [6, 3, 5, 2, 4, 1]],
    [8, [3, 6, 2, 5, 1, 4]],
  ] as const)('normalizes orientation %i', (orientation, pixels) => {
    const frame = new ImageData(new Uint8ClampedArray([1, 2, 3, 4, 5, 6].flatMap((value) => [value, 0, 0, 255])), 3, 2);
    const preview = renderGeometry(frame, fullGeometry(frame, orientation));
    expect([...preview.data.filter((_, index) => index % 4 === 0)]).toEqual(pixels);
    const result = orient(frame, orientation);
    expect([result.width, result.height]).toEqual(orientation >= 5 ? [2, 3] : [3, 2]);
    expect(result.data.buffer).toBe(frame.data.buffer);
    expect([...result.data.filter((_, index) => index % 4 === 0)]).toEqual(pixels);
  });
});

describe('WASM export goldens', () => {
  it('matches exact preview and export pixels after EXIF orientation, an odd crop, rotation, and both flips', async () => {
    const original = await fixture('odd-oriented.png');
    const edits = [
      crop(1, { left: 1 / 3, top: 1 / 5, right: 1, bottom: 4 / 5 }),
      crop(8), crop(2), crop(4),
    ];
    const expected = [9, 8, 7, 4, 3, 2].flatMap((value) => [value, 32, 64, 255]);
    const preview = await renderPreview({ id: 'odd', original, commands: edits }, silent);
    expect(preview.info).toMatchObject({ width: 3, height: 2 });
    const first = await exportImage({ id: 'odd', original, commands: [convert('png'), ...edits] }, silent);
    const last = await exportImage({ id: 'odd', original, commands: [...edits, convert('png')] }, silent);
    for (const blob of [preview.blob, first.blob, last.blob]) {
      const { frame } = await decodeImage(blob);
      expect([frame.width, frame.height]).toEqual([3, 2]);
      expect([...frame.data]).toEqual(expected);
    }
    const { load } = await import('exifreader');
    expect(load(await last.blob.arrayBuffer(), { expanded: true }).exif).toBeUndefined();
  });

  it('projects a full-resolution crop onto the downsampled base with matching corner placement', async () => {
    const original = await fixture('oriented.png');
    const commands = [crop(6, { left: 0, top: 0, right: .5, bottom: 1 }), crop(4)];
    const preview = await renderPreview({ id: 'scaled-crop', original, commands, maxEdge: 48 }, silent);
    expect(preview.info).toMatchObject({ width: 48, height: 64 });
    const { frame: sample } = await decodeImage(preview.blob);
    const { blob } = await exportImage({ id: 'scaled-crop', original, commands }, silent);
    const { frame } = await decodeImage(blob);
    expect([sample.width, sample.height]).toEqual([24, 32]);
    expect([frame.width, frame.height]).toEqual([48, 64]);
    expect(rgba(sample, 0, 0)).toEqual([38, 170, 80, 255]);
    expect(rgba(sample, 23, 31)).toEqual([255, 214, 60, 255]);
    expect(rgba(frame, 0, 0)).toEqual(rgba(sample, 0, 0));
    expect(rgba(frame, 47, 63)).toEqual(rgba(sample, 23, 31));
  });

  it.each(['jpeg', 'png', 'webp', 'avif'] as const)('encodes decodable %s pixels with preserved dimensions', async (format) => {
    const original = await fixture('transparent.png');
    const { blob, name } = await exportImage({ id: 'alpha', original, commands: [convert(format, 90, '#000000')] }, silent);
    expect(name).toBe(`transparent.${outputFormats[format].extension}`);
    expect(blob.type).toBe(outputFormats[format].mime);
    expect(detectFormat(await blob.arrayBuffer())).toBe(format);
    const { frame } = await decodeImage(blob);
    expect([frame.width, frame.height]).toEqual([96, 64]);
    if (format === 'jpeg') {
      near(rgba(frame, 8, 8), [0, 0, 0, 255], 4);
      near(rgba(frame, 80, 22), [113, 24, 71, 255], 15);
    } else {
      expect(rgba(frame, 8, 8)[3]).toBe(0);
      expect(rgba(frame, 80, 22)[3]).toBe(120);
      near(rgba(frame, 80, 22), [240, 50, 150, 120], format === 'png' ? 0 : 20);
    }
  });

  it('bakes orientation, strips EXIF, and encodes distinct quality levels', async () => {
    const original = await fixture('oriented.jpg');
    const low = await exportImage({ id: 'low', original, commands: [convert('jpeg', 20)] }, silent);
    const high = await exportImage({ id: 'high', original, commands: [convert('jpeg', 95)] }, silent);
    const { load } = await import('exifreader');
    expect(load(await original.arrayBuffer()).Orientation?.value).toBe(6);
    expect(load(await original.arrayBuffer()).ImageDescription?.description).toBe('filekit-private-fixture-marker');
    expect(load(await high.blob.arrayBuffer(), { expanded: true }).exif).toBeUndefined();
    const lowBytes = new Uint8Array(await low.blob.arrayBuffer());
    const highBytes = new Uint8Array(await high.blob.arrayBuffer());
    const dcLuma = (bytes: Uint8Array) => {
      const table = bytes.findIndex((value, index) => value === 0xff && bytes[index + 1] === 0xdb);
      expect(table).toBeGreaterThan(0);
      return bytes[table + 4] >> 4 ? bytes[table + 5] * 256 + bytes[table + 6] : bytes[table + 5];
    };
    expect(dcLuma(lowBytes)).toBeGreaterThan(dcLuma(highBytes));
    const { frame } = await decodeImage(high.blob);
    expect([frame.width, frame.height]).toEqual([64, 96]);
    near(rgba(frame, 12, 12), [39, 107, 214, 255], 10);
  });

  it('caps the preview and keeps a 24 MP export at full dimensions', async () => {
    const original = await fixture('large-6000x4000.jpg');
    const request = { id: 'large', original, commands: [convert('jpeg', 70)] };
    const preview = await renderPreview({ ...request, maxEdge: 1000 }, silent);
    expect(preview.info).toMatchObject({ width: 6000, height: 4000, output: { format: 'jpeg', quality: 70 } });
    const { frame: sample } = await decodeImage(preview.blob);
    expect([sample.width, sample.height]).toEqual([1000, 666]);

    const { blob } = await exportImage(request, silent);
    const { frame } = await decodeImage(blob);
    expect([frame.width, frame.height]).toEqual([6000, 4000]);
    near(rgba(frame, 100, 100), [230, 65, 46, 255], 10);
  }, 30_000);

  it('reuses the selected preview across background intake and export, then evicts it on selection change', async () => {
    const first = { id: 'cached', original: await fixture('oriented.png'), commands: [] };
    const second = { id: 'other', original: await fixture('transparent.png'), commands: [] };
    const stages: string[] = [];
    const progress = ({ stage }: { stage: string }) => stages.push(stage);
    await renderPreview(first, progress);
    await renderPreview({ ...first, maxEdge: 70 }, progress);
    expect(stages.splice(0)).toEqual(['Decoding', 'Rendering preview', 'Rendering preview']);

    await renderPreview({ ...second, cache: false }, progress);
    await exportImage(first, progress);
    await renderPreview({ ...first, maxEdge: 70, commands: [convert('avif')] }, progress);
    expect(stages.splice(0)).toEqual(['Decoding', 'Rendering preview', 'Decoding', 'Encoding', 'Rendering preview']);

    await renderPreview(second, progress);
    await renderPreview(first, progress);
    expect(stages).toEqual(['Decoding', 'Rendering preview', 'Decoding', 'Rendering preview']);
  });

  it('archives each successful result with unique names and reports failures by file', async () => {
    const original = await fixture('transparent.png');
    const broken = await fixture('broken.jpg');
    const stages: string[] = [];
    const zip = await exportZip([
      { id: 'first', original, commands: [convert('png')] },
      { id: 'bad', original: broken, commands: [] },
      { id: 'second', original, commands: [convert('png')] },
    ], ({ id, stage }) => stages.push(`${id} ${stage}`));
    expect(zip.count).toBe(2);
    expect(zip.failures).toEqual([{ id: 'bad', message: expect.stringContaining('could not be decoded') }]);
    expect(zip.blob?.type).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(await zip.blob!.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(['transparent.png', 'transparent (2).png']);
    expect(detectFormat(new Uint8Array(entries['transparent.png']).buffer)).toBe('png');
    expect(entries['transparent.png']).toEqual(entries['transparent (2).png']);
    expect(stages).toEqual(['first Decoding', 'first Encoding', 'first Packaging', 'bad Decoding', 'second Decoding', 'second Encoding', 'second Packaging']);
  });
});

describe('background removal compositing', () => {
  const matte = (width: number, height: number, alpha: Uint8Array<ArrayBuffer>, outputMaxEdge?: 1280) => ({
    id: crypto.randomUUID(), width, height, alpha: new Blob([alpha]), tier: 'Lite' as const, provider: 'wasm' as const,
    outputMaxEdge,
  });

  it('unmixes a white screen from fine, half-covered hair composited on dark green', async () => {
    // Opaque white, a 50% dark strand photographed on white, and opaque hair.
    const prepared = () => new ImageData(Uint8ClampedArray.of(
      255, 255, 255, 255, 137, 142, 147, 255, 20, 30, 40, 255,
    ), 3, 1);
    const options = { color: '#104e32', mask: matte(3, 1, Uint8Array.of(0, 128, 255)) };
    const cutout = await compositeBackground(prepared(), { ...options, mode: 'transparent' });
    near(rgba(cutout, 1, 0), [20, 30, 40, 128], 2);
    const green = await compositeBackground(prepared(), { ...options, mode: 'solid' });
    expect(rgba(green, 0, 0)).toEqual([16, 78, 50, 255]);
    near(rgba(green, 1, 0), [18, 54, 45, 255], 2);
    expect(rgba(green, 2, 0)).toEqual([20, 30, 40, 255]);
  });

  it('blurs the original background and preserves opaque foreground pixels', async () => {
    const frame = new ImageData(Uint8ClampedArray.of(
      240, 20, 40, 255, 16, 40, 100, 255, 140, 20, 40, 255,
    ), 3, 1);
    const result = await compositeBackground(frame, {
      mode: 'blur', color: '#ffffff', mask: matte(3, 1, Uint8Array.of(0, 255, 0)),
    });
    expect(rgba(result, 1, 0)).toEqual([16, 40, 100, 255]);
    expect(rgba(result, 0, 0)[0]).toBeLessThan(240);
    expect(rgba(result, 0, 0).slice(1)).toEqual([20, 40, 255]);
  });

  it.each(['png', 'webp', 'avif', 'jpeg'] as const)('replays EXIF, background and crop in either order for %s', async (format) => {
    const original = await fixture('oriented.jpg');
    const remove = { toolId: 'remove-background', options: {
      mode: 'transparent', color: '#104e32', mask: matte(2, 3, Uint8Array.of(0, 255, 0, 255, 0, 255)),
    } };
    const rotate = crop(6, { left: 0.125, top: 0, right: 0.875, bottom: 1 });
    const first = await exportImage({ id: 'bg', original, commands: [remove, rotate, convert(format, 98)] }, silent);
    const later = await exportImage({ id: 'bg', original, commands: [convert(format, 98), rotate, remove] }, silent);
    const firstPixels = (await decodeImage(first.blob)).frame;
    const secondPixels = (await decodeImage(later.blob)).frame;
    expect([firstPixels.width, firstPixels.height]).toEqual([72, 64]);
    expect([...firstPixels.data]).toEqual([...secondPixels.data]);
    if (format === 'jpeg') near(rgba(firstPixels, 50, 1), [16, 78, 50, 255], 17);
    else expect(rgba(firstPixels, 50, 1)[3]).toBe(0);
  });
});

it('uses original desktop dimensions and the disclosed iOS output cap after rotation', async () => {
  const original = await fixture('large-6000x4000.jpg');
  const createEdit = (outputMaxEdge?: 1280) => ({
    toolId: 'remove-background',
    options: { mode: 'transparent', color: '#104e32', mask: {
      id: 'cap', width: 3, height: 2, alpha: new Blob([Uint8Array.of(0, 0, 255, 0, 0, 255)]),
      tier: 'Lite', provider: 'wasm', outputMaxEdge,
    } },
  });
  const preview = await renderPreview({ id: 'full-bg', original, commands: [crop(6), createEdit()], maxEdge: 120 }, silent);
  expect(preview.info).toMatchObject({ width: 4000, height: 6000, output: { format: 'png' } });
  const request = { id: 'phone-bg', original, commands: [createEdit(1280), crop(6)] };
  const bounded = await renderPreview({ ...request, maxEdge: 120 }, silent);
  expect(bounded.info).toMatchObject({ width: 853, height: 1280, output: { format: 'png' } });
  const result = await exportImage(request, silent);
  const { frame } = await decodeImage(result.blob);
  expect([frame.width, frame.height]).toEqual([853, 1280]);
});
