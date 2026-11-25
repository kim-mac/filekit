import { fileURLToPath } from 'node:url';

export const here = fileURLToPath(new URL('.', import.meta.url));
export const fixturesDir = fileURLToPath(new URL('../../test/fixtures/bg/', import.meta.url));
export const weightsDir = fileURLToPath(new URL('../../.cache/bg-bench/weights/', import.meta.url));
export const ortDir = fileURLToPath(new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url));
export const chunkBytes = 24 * 1024 * 1024;
