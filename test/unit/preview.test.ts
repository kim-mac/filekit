import { expect, it, vi } from 'vitest';
import { resizePreview } from '../../lib/workers/image/pixels';

it('box-filters fractional ratios and averages premultiplied color', () => {
  vi.stubGlobal('ImageData', class {
    readonly data: Uint8ClampedArray;
    constructor(readonly width: number, readonly height: number) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  });
  try {
    const source = new ImageData(3, 1);
    source.data.set([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255]);
    const result = resizePreview(source, 2);
    expect([result.width, result.height]).toEqual([2, 1]);
    expect([...result.data]).toEqual([255, 0, 0, 170, 0, 0, 255, 170]);
  } finally {
    vi.unstubAllGlobals();
  }
});
