import { describe, expect, it } from 'vitest';
import { bmpBytes, extrapolateBytes, formatBytes, formatIconDimensions } from '../../lib/tools/image/size-estimate';

describe('output size estimates', () => {
  it('uses actual encoded bytes at full size and scales a reduced sample by area', () => {
    expect(extrapolateBytes(900, { width: 96, height: 64 }, { width: 96, height: 64 })).toBe(900);
    expect(extrapolateBytes(14_000, { width: 384, height: 256 }, { width: 1920, height: 1280 })).toBe(350_000);
  });

  it('accounts for padded 24-bit BMP rows and the 54-byte header', () => {
    expect(bmpBytes({ width: 4, height: 2 })).toBe(78);
    expect(bmpBytes({ width: 5, height: 2 })).toBe(86);
  });

  it('renders decimal units and lists all selected ICO dimensions', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(12_345)).toBe('12.3 kB');
    expect(formatBytes(1_234_567)).toBe('1.2 MB');
    expect(formatIconDimensions([16, 48])).toBe('16 × 16, 48 × 48 px');
  });
});
