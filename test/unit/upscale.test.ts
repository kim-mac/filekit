import { describe, expect, it } from 'vitest';
import { parseUpscale, upscaleLimitError, upscaleSize } from '../../lib/tools/image/upscale-options';
import { blendTile, tileAxis } from '../../lib/workers/upscale/tiles';

function pixels(width: number, height: number, fill = 0) {
  return { data: new Uint8ClampedArray(width * height * 4).fill(fill), width, height } as ImageData;
}

describe('upscale tiles', () => {
  it('plans a one-pixel tail, two-sided overlap, and clipped context for odd sizes', () => {
    expect(tileAxis(17, 8, 2, 3)).toEqual([
      { start: 0, end: 10, readStart: 0, readEnd: 13, fadeOut: 8 },
      { start: 6, end: 17, readStart: 3, readEnd: 17, fadeIn: 8, fadeOut: 16 },
      { start: 14, end: 17, readStart: 11, readEnd: 17, fadeIn: 16 },
    ]);
    expect(tileAxis(1, 8, 2, 3)).toEqual([{ start: 0, end: 1, readStart: 0, readEnd: 1 }]);
    expect(() => tileAxis(12, 3, 2, 1)).toThrow('Invalid upscale tile dimensions');
  });

  it('feathers synthetic discontinuities in both directions and covers every pixel', () => {
    const original = pixels(9, 9, 255);
    const scale = 2;
    const output = pixels(18, 18);
    const axes = tileAxis(9, 6, 2, 0);
    for (const [row, y] of axes.entries()) {
      for (const [column, x] of axes.entries()) {
        const length = (x.readEnd - x.readStart) * (y.readEnd - y.readStart) * 16;
        const rgb = new Float32Array(length * 3).fill((row * 120 + column * 80) / 255);
        blendTile(output, original, rgb, x, y, scale, 2, false);
      }
    }
    const at = (x: number, y: number) => output.data[(y * output.width + x) * 4];
    expect([...Array(10)].map((_, i) => at(i + 7, 0))).toEqual([0, 5, 15, 25, 35, 45, 55, 65, 75, 80]);
    expect([...Array(10)].map((_, i) => at(0, i + 7))).toEqual([0, 8, 23, 38, 53, 68, 83, 98, 113, 120]);
    expect(at(12, 12)).toBeCloseTo(113, 0);
    expect(at(17, 17)).toBe(200);
    expect(output.data.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  });
});

describe('upscale limits', () => {
  it('accepts the pixel limits, rejects excess area and caps panoramic edges', () => {
    expect(upscaleLimitError(upscaleSize({ width: 2000, height: 2000 }, 4), false)).toBeUndefined();
    expect(upscaleLimitError(upscaleSize({ width: 2001, height: 2000 }, 4), false)).toMatch(/64 MP/);
    expect(upscaleLimitError(upscaleSize({ width: 1000, height: 1000 }, 4), true)).toBeUndefined();
    expect(upscaleLimitError(upscaleSize({ width: 1000, height: 1001 }, 4), true)).toMatch(/16 MP/);
    expect(upscaleLimitError({ width: 16381, height: 1 }, false)).toMatch(/16,380 px/);
    expect(upscaleLimitError({ width: 8193, height: 1 }, true)).toMatch(/8,192 px/);
    expect(() => parseUpscale({ scale: 3, mode: 'photo', mobile: false })).toThrow('Choose a scale');
  });
});

it('limits the retained full-resolution stage on mobile and low-memory devices', async () => {
  const { upscaleCacheBudget } = await import('../../lib/workers/upscale/cache-budget');
  expect(upscaleCacheBudget(false, 8)).toBeGreaterThan(4000 * 4000 * 4);
  expect(upscaleCacheBudget(false, 4)).toBe(32 * 2 ** 20);
  expect(upscaleCacheBudget(true, 8)).toBe(32 * 2 ** 20);
  expect(upscaleCacheBudget(true, 2)).toBe(16 * 2 ** 20);
});
