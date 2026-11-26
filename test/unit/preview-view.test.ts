import { describe, expect, it } from 'vitest';
import { fitScale, framePoint, zoomAt } from '../../lib/tools/image/preview-view';

describe('preview viewport coordinates', () => {
  it('fits the image to the limiting edge in either orientation', () => {
    expect(fitScale({ width: 4000, height: 2000 }, { width: 800, height: 600 })).toBe(0.2);
    expect(fitScale({ width: 2000, height: 4000 }, { width: 800, height: 600 })).toBe(0.15);
  });

  it('preserves the point under a zoom anchor and follows a moving pinch midpoint', () => {
    const view = { scale: 2, x: 30, y: -20 };
    expect(zoomAt(view, 3, { x: 50, y: 20 })).toEqual({ scale: 3, x: 20, y: -40 });
    expect(zoomAt(view, 3, { x: 50, y: 20 }, { x: 80, y: 5 })).toEqual({ scale: 3, x: 50, y: -55 });
  });

  it('maps the same pointer location before and after zoom and pan', () => {
    const fit = { left: 100, top: 200, width: 240, height: 120 };
    const zoomed = { left: -140, top: 130, width: 720, height: 360 };
    expect(framePoint({ x: 160, y: 290 }, fit)).toEqual({ x: 0.25, y: 0.75 });
    expect(framePoint({ x: 40, y: 400 }, zoomed)).toEqual({ x: 0.25, y: 0.75 });
    expect(framePoint({ x: -860, y: 130 }, zoomed)).toEqual({ x: -1, y: 0 });
  });
});
