import { expect, it } from 'vitest';
import { wasmThreads } from '../../lib/workers/wasm-threads.mjs';

it('uses one thread outside isolation and caps shared-memory pools by device class', () => {
  expect(wasmThreads(false, 16, false)).toBe(1);
  expect(wasmThreads(false, 16, true)).toBe(8);
  expect(wasmThreads(false, 4, true)).toBe(4);
  expect(wasmThreads(true, 16, true)).toBe(2);
  expect(wasmThreads(true, 1, true)).toBe(1);
});
