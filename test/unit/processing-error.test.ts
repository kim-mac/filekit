import { expect, test } from 'vitest';
import { memoryRecovery, processingMessage } from '../../lib/core/processing-error';

test('reports memory recovery even if a codec wraps the original allocation error', () => {
  const error = new Error('Codec failed', { cause: new RangeError('Array buffer allocation failed') });
  expect(processingMessage(error)).toBe(memoryRecovery);
});

test('uses the original error for unrelated failures', () => {
  expect(processingMessage(new Error('Invalid model manifest.'))).toBe('Invalid model manifest.');
});
