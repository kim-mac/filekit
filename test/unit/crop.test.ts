import { describe, expect, it } from 'vitest';
import { cropTool } from '../../lib/tools/image/crop';
import {
  combineOrientations, editGeometry, fullBounds, fullGeometry, geometrySize, orientBounds, scaleGeometry,
} from '../../lib/tools/image/geometry';

describe('crop geometry', () => {
  it('rounds each edge against the oriented raster and retains at least one pixel', () => {
    const geometry = fullGeometry({ width: 5, height: 3 }, 6);
    const crop = editGeometry(geometry, { left: 1 / 3, top: 1 / 5, right: 1, bottom: 4 / 5 }, 1);
    expect(crop).toEqual({ orientation: 6, bounds: { left: 1, top: 0, right: 4, bottom: 2 } });
    expect(geometrySize(crop)).toEqual({ width: 2, height: 3 });

    const tiny = editGeometry(geometry, { left: .98, top: .98, right: .99, bottom: .99 }, 1);
    expect(geometrySize(tiny)).toEqual({ width: 1, height: 1 });
  });

  it('composes rotations and flips in the order the user applies them', () => {
    expect(combineOrientations(6, 8)).toBe(1);
    expect(combineOrientations(8, 6)).toBe(1);
    expect(combineOrientations(6, 2)).toBe(5);
    expect(combineOrientations(2, 6)).toBe(7);
    expect(combineOrientations(2, 4)).toBe(3);
    expect(combineOrientations(4, 4)).toBe(1);
    const bounds = { left: .125, top: .25, right: .5, bottom: .75 };
    expect(orientBounds(bounds, 6)).toEqual({ left: .25, top: .125, right: .75, bottom: .5 });
    expect(orientBounds(bounds, 8)).toEqual({ left: .25, top: .5, right: .75, bottom: .875 });
    expect(orientBounds(bounds, 2)).toEqual({ left: .5, top: .25, right: .875, bottom: .75 });
    expect(orientBounds(bounds, 4)).toEqual(bounds);
  });

  it('projects the final source bounds to the preview after full-resolution rounding', () => {
    const original = { width: 11, height: 9 };
    const preview = { width: 5, height: 4 };
    const geometry = editGeometry(fullGeometry(original), { left: .11, top: .2, right: .7, bottom: .8 }, 8);
    expect(geometrySize(geometry)).toEqual({ width: 5, height: 7 });
    expect(scaleGeometry(geometry, original, preview)).toEqual({
      orientation: 8, bounds: { left: 1, top: 0, right: 4, bottom: 3 },
    });
  });

  it.each([
    null, { orientation: 9, bounds: fullBounds },
    { orientation: 1, bounds: { ...fullBounds, left: -.2 } },
    { orientation: 1, bounds: { ...fullBounds, right: 0 } },
    { orientation: 1, bounds: { ...fullBounds, top: NaN } },
    { orientation: 1, bounds: { ...fullBounds, bottom: 1.01 } },
    { orientation: 1, bounds: fullBounds, preset: 'toString' },
  ])('rejects invalid crop options %j', (value) => {
    expect(() => cropTool.parseOptions(value)).toThrow();
  });
});
