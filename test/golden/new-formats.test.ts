import { readFile } from 'node:fs/promises';
import { ImageMagick } from '@imagemagick/magick-wasm';
import sharp from 'sharp';
import { beforeAll, expect, it } from 'vitest';
import { defaultConvertOptions, iconSizes, outputFormats } from '../../lib/tools/image/formats';
import { decodeImage } from '../../lib/workers/image/codecs';
import { initializeExtendedCodecs } from '../../lib/workers/image/extended-codecs';
import { exportImage, renderComparison, renderPreview } from '../../lib/workers/image/pipeline';
import { initializeWasm, readWasm } from './wasm';

const silent = () => {};
const fixture = async (name: string) => new File(
  [new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)))], name,
);
const conversion = (format: 'gif' | 'bmp' | 'tiff' | 'ico') => ({ toolId: 'convert', options: { ...defaultConvertOptions, format } });

beforeAll(async () => {
  await initializeWasm();
  await initializeExtendedCodecs(await readWasm('@imagemagick/magick-wasm/magick.wasm'));
}, 30_000);

it('keeps GIF and exports exactly the first frame of animated input', async () => {
  const original = await fixture('animated.gif');
  for (const commands of [[], [conversion('gif')]]) {
    const { name, blob } = await exportImage({ id: 'gif', original, commands }, silent);
    const bytes = Buffer.from(await blob.arrayBuffer());
    expect(name).toBe('animated.gif');
    expect(blob.type).toBe('image/gif');
    expect(bytes.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 96, height: 64, format: 'gif', pages: 1 });
    const { frame } = await decodeImage(blob);
    expect([...frame.data.subarray((12 * 96 + 12) * 4, (12 * 96 + 13) * 4)]).toEqual([230, 65, 46, 255]);
  }
});

it('writes an opaque 24-bit BMP using the selected transparency fill', async () => {
  const original = await fixture('transparent.png');
  const change = conversion('bmp');
  const result = await exportImage({
    id: 'bmp', original, commands: [{ ...change, options: { ...change.options, background: '#104e32' } }],
  }, silent);
  const bytes = Buffer.from(await result.blob.arrayBuffer());
  expect(result.name).toBe('transparent.bmp');
  expect(result.blob.type).toBe('image/bmp');
  expect(bytes.subarray(0, 2).toString()).toBe('BM');
  expect(bytes.readInt32LE(18)).toBe(96);
  expect(bytes.readInt32LE(22)).toBe(64);
  expect(bytes.readUInt16LE(28)).toBe(24);
  ImageMagick.read(bytes, image => {
    expect([image.width, image.height]).toEqual([96, 64]);
    expect(image.getPixels(pixels => Array.from(pixels.toByteArray(8, 8, 1, 1, 'RGBA')!))).toEqual([16, 78, 50, 255]);
  });
});

it('writes a TIFF with dimensions and alpha preserved', async () => {
  const original = await fixture('transparent.png');
  const { name, blob } = await exportImage({ id: 'tiff', original, commands: [conversion('tiff')] }, silent);
  const bytes = Buffer.from(await blob.arrayBuffer());
  expect(name).toBe('transparent.tiff');
  expect(blob.type).toBe('image/tiff');
  expect([0x49492a00, 0x4d4d002a]).toContain(bytes.readUInt32BE(0));
  expect(await sharp(bytes).metadata()).toMatchObject({ format: 'tiff', width: 96, height: 64, hasAlpha: true });
  const pixel = await sharp(bytes).extract({ left: 80, top: 22, width: 1, height: 1 }).raw().toBuffer();
  expect([...pixel]).toEqual([240, 50, 150, 120]);
});

it('writes the requested sizes into one ICO with centered, decodable PNG entries', async () => {
  const original = await fixture('reference.webp');
  for (const sizes of [iconSizes, [32, 128] as const, [48] as const]) {
    const change = conversion('ico');
    const { name, blob } = await exportImage({
      id: 'ico', original, commands: [{ ...change, options: { ...change.options, iconSizes: sizes } }],
    }, silent);
    const bytes = Buffer.from(await blob.arrayBuffer());
    expect(name).toBe('reference.ico');
    expect(blob.type).toBe(outputFormats.ico.mime);
    expect(bytes.readUInt32LE(0)).toBe(0x10000);
    expect(bytes.readUInt16LE(4)).toBe(sizes.length);
    for (const [index, size] of sizes.entries()) {
      const entry = 6 + index * 16;
      expect(bytes[entry] || 256).toBe(size);
      expect(bytes[entry + 1] || 256).toBe(size);
      const start = bytes.readUInt32LE(entry + 12);
      const png = sharp(bytes.subarray(start, start + bytes.readUInt32LE(entry + 8)));
      expect(await png.metadata()).toMatchObject({ format: 'png', width: size, height: size, hasAlpha: true });
      const pixel = await png.extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
      expect(pixel[3]).toBe(0);
    }
  }
});

it('uses JPG for HEIC when the original format is kept', async () => {
  const original = await fixture('reference.heic');
  const request = { id: 'heic', original, commands: [] };
  expect((await renderPreview(request, silent)).info).toMatchObject({
    format: 'heic', conversion: { format: 'original' }, output: { format: 'jpeg' },
  });
  const { name, blob } = await exportImage(request, silent);
  expect(name).toBe('reference.jpg');
  expect(await sharp(Buffer.from(await blob.arrayBuffer())).metadata()).toMatchObject({ format: 'jpeg', width: 96, height: 64 });
});

it('compares the same original pixels after crop and rotation', async () => {
  const original = await fixture('odd-oriented.png');
  const id = 'comparison';
  const commands = [{ toolId: 'crop', options: {
    bounds: { left: 0, top: 0, right: 0.66, bottom: 1 }, orientation: 6,
  } }];
  const preview = await renderPreview({ id, original, commands }, silent);
  const before = await renderComparison({ id, original, mapping: preview.mapping });
  const { frame: edited } = await decodeImage(preview.blob);
  const { frame } = await decodeImage(before);
  expect([frame.width, frame.height]).toEqual([edited.width, edited.height]);
  expect([...frame.data]).toEqual([...edited.data]);
});
