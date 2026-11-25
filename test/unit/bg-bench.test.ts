import { describe, expect, it } from 'vitest';
import { maskScores } from '../../scripts/bg-bench/metrics';
import { guidedAlpha } from '../../scripts/bg-bench/refine';

describe('background benchmark metrics', () => {
  it('thresholds a grayscale alpha and scores exact, shifted, and disjoint boundaries', () => {
    const a = new Uint8Array(7 * 3);
    const b = new Uint8Array(a.length);
    a[9] = 128;
    a[10] = 127;
    b[9] = 255;
    expect(maskScores(a, b, 7, 3)).toEqual({ iou: 1, boundaryF: 1 });
    b[9] = 0;
    b[10] = 255;
    expect(maskScores(a, b, 7, 3)).toEqual({ iou: 0, boundaryF: 1 });
    b[10] = 0;
    b[13] = 255;
    expect(maskScores(a, b, 7, 3)).toEqual({ iou: 0, boundaryF: 0 });
  });

  it('handles empty masks and rejects mismatched dimensions', () => {
    const empty = new Uint8Array(4);
    expect(maskScores(empty, empty, 2, 2)).toEqual({ iou: 1, boundaryF: 1 });
    expect(maskScores(empty, Uint8Array.of(255, 0, 0, 0), 2, 2)).toEqual({ iou: 0, boundaryF: 0 });
    expect(() => maskScores(empty, empty, 1, 1)).toThrow('Mask dimensions differ');
  });
});

describe('guided alpha refinement', () => {
  it('preserves a constant mask even when the guidance varies', () => {
    const source = {
      data: Uint8ClampedArray.of(0, 0, 0, 255, 150, 160, 170, 255, 255, 255, 255, 255),
      width: 3,
      height: 1,
    } as ImageData;
    const alpha = Uint8Array.of(132, 132, 132);
    expect(guidedAlpha(source, alpha)).toEqual(alpha);
  });
});
