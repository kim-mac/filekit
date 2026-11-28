import { describe, expect, it } from 'vitest';
import { modelForBg0 } from '../../lib/tools/image/background-model';

describe('background model choice', () => {
  it('passes Auto through when FileKit can use bg0 device detection', () => {
    expect(modelForBg0('auto', false)).toBe('auto');
  });

  it('uses Fast for Auto on devices restricted by FileKit policy', () => {
    expect(modelForBg0('auto', true)).toBe('lite');
  });

  it('preserves a pinned model even on devices where Auto uses Fast', () => {
    expect(modelForBg0('full', true)).toBe('full');
    expect(modelForBg0('lite', false)).toBe('lite');
  });
});
