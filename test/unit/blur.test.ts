import { describe, expect, it } from 'vitest';
import { defaultBlur, parseBlur, type BlurOptions, type BlurRegion } from '../../lib/tools/image/blur-options';
import { applyRegionBlur } from '../../lib/workers/image/blur';

const rectangle: BlurRegion = { kind: 'rectangle', bounds: { left: 0.25, top: 0, right: 0.75, bottom: 1 } };
const pixels = (width: number, height: number, red: (x: number, y: number) => number): ImageData => ({
  width, height, colorSpace: 'srgb',
  data: Uint8ClampedArray.from(Array.from({ length: width * height }, (_, index) =>
    [red(index % width, Math.floor(index / width)), 0, 0, 255]).flat()),
});
const reds = ({ data }: ImageData) => [...data.filter((_, index) => index % 4 === 0)];
const pixelate: BlurOptions = { ...defaultBlur, effect: 'pixelate', regions: [rectangle] };

describe('Region blur', () => {
  it('changes only the selected rectangle for Gaussian blur and preserves exact RGBA elsewhere', () => {
    const frame = pixels(20, 10, (x, y) => (x + y) % 2 ? 255 : 0);
    const before = frame.data.slice();
    applyRegionBlur(frame, { ...defaultBlur, strength: 100, regions: [rectangle] });
    for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
      const index = pixel * 4;
      const x = pixel % frame.width;
      if (x >= 5 && x < 15) expect(frame.data[index]).toBeGreaterThan(0);
      else expect(frame.data.slice(index, index + 4)).toEqual(before.slice(index, index + 4));
    }
  });

  it('aligns pixelation to the image origin, even where a region bisects a block', () => {
    const frame = pixels(8, 2, x => x * 10);
    applyRegionBlur(frame, { ...pixelate, regions: [
      { kind: 'rectangle', bounds: { left: 3 / 8, top: 0, right: 7 / 8, bottom: 1 } },
    ] });
    expect(reds(frame)).toEqual(Array(2).fill([0, 10, 20, 25, 45, 45, 65, 70]).flat());
  });

  it('keeps full-resolution block grid boundaries on a scaled preview', () => {
    const frame = pixels(52, 1, x => x * 4);
    applyRegionBlur(frame, { ...pixelate, blockSize: 24, regions: [], inverted: true }, { width: 1000, height: 20 });
    // First boundaries at 1.248, 2.496 and 3.744 preview pixels.
    expect(reds(frame).slice(0, 7)).toEqual([0, 4, 10, 10, 16, 20, 24]);
  });

  it('leaves the selected region intact when inverted', () => {
    const frame = pixels(8, 2, x => x * 10);
    applyRegionBlur(frame, { ...pixelate, inverted: true });
    expect(reds(frame)).toEqual(Array(2).fill([5, 5, 20, 30, 40, 50, 65, 65]).flat());
  });

  it('fills the span between brush points and subtracts an eraser stroke', () => {
    const frame = pixels(8, 4, (x, y) => (x + y) % 2 ? 200 : 0);
    const before = reds(frame);
    applyRegionBlur(frame, { ...pixelate, regions: [
      { kind: 'brush', diameter: 0.4, points: [{ x: 0.2, y: 0.375 }, { x: 0.8, y: 0.375 }] },
      { kind: 'eraser', diameter: 0.35, points: [{ x: 0.5, y: 0.375 }] },
    ] });
    expect(reds(frame).slice(0, 8)).toEqual(before.slice(0, 8));
    expect(reds(frame).slice(8, 16)).toEqual([200, 100, 100, 0, 200, 100, 100, 0]);
  });

  it('uses the ellipse boundary and avoids bleeding hidden RGB into opaque pixels', () => {
    const frame = pixels(8, 8, (x, y) => (x + y) % 2 ? 200 : 0);
    applyRegionBlur(frame, { ...pixelate, regions: [
      { kind: 'ellipse', bounds: { left: 0, top: 0, right: 1, bottom: 1 } },
    ] });
    expect([reds(frame)[0], reds(frame)[1], reds(frame)[27]]).toEqual([0, 200, 100]);
    const alpha = pixels(2, 1, x => x ? 222 : 0);
    alpha.data[7] = 0;
    applyRegionBlur(alpha, { ...pixelate, regions: [], inverted: true });
    expect([...alpha.data]).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
  });

  it.each([
    { ...defaultBlur, blockSize: 1 },
    { ...defaultBlur, strength: NaN },
    { ...defaultBlur, regions: [{ kind: 'brush', diameter: 0.1, points: [{ x: 2, y: 0 }] }] },
    { ...defaultBlur, regions: [{ kind: 'ellipse', bounds: { left: 0.6, right: 0.2, top: 0, bottom: 1 } }] },
  ])('rejects malformed options %#', options => {
    expect(() => parseBlur(options)).toThrow();
  });
});
