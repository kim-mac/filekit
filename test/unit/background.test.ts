import { describe, expect, it } from 'vitest';
import { defaultBackground, parseBackground, type BackgroundMask } from '../../lib/tools/image/background-options';

const mask: BackgroundMask = {
  id: 'test', width: 3, height: 2, alpha: new Blob([new Uint8Array(6)]), tier: 'Lite', provider: 'wasm',
};

describe('background history options', () => {
  it('keeps the verified matte while changing the background', () => {
    expect(parseBackground({ ...defaultBackground, mode: 'solid', color: '#104E32', mask }))
      .toEqual({ mode: 'solid', color: '#104e32', mask });
  });

  it('rejects mismatched dimensions and invalid backgrounds', () => {
    expect(() => parseBackground({ ...defaultBackground, mask: { ...mask, width: 5 } })).toThrow('Invalid background mask');
    expect(() => parseBackground({ ...defaultBackground, color: 'white' })).toThrow('Choose a valid background color');
    expect(() => parseBackground({ ...defaultBackground, mode: 'unknown' })).toThrow('Choose a background');
  });
});
