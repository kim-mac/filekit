import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConvertOptions, outputFormats, type OutputFormat } from '../../lib/tools/image/formats';
import { decodeImage } from '../../lib/workers/image/codecs';
import { detectFormat } from '../../lib/workers/image/headers';
import { exportImage, exportZip, renderPreview } from '../../lib/workers/image/pipeline';
import { orient } from '../../lib/workers/image/pixels';
import { initializeWasm } from './wasm';

const silent = () => {};
const convert = (format: OutputFormat, quality = 85, background = '#ffffff') => (
  { toolId: 'convert', options: { ...defaultConvertOptions, format, quality, background } }
);
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
    const result = orient(frame, orientation);
    expect([result.width, result.height]).toEqual(orientation >= 5 ? [2, 3] : [3, 2]);
    expect([...result.data.filter((_, index) => index % 4 === 0)]).toEqual(pixels);
  });
});

describe('WASM export goldens', () => {
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
