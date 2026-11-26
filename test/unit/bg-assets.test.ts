import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetResponse } from '../../lib/workers/bg0/asset-stream.mjs';

const base = 'https://filekit.test';
const data = new Uint8Array([9, 2, 6, 5]);
const sha256 = createHash('sha256').update(data).digest('hex');
const path = `/bg-models/chunks/${sha256}/0.bin`;
const manifest = { bytes: data.length, sha256, parts: [{ bytes: data.length, sha256 }] };

afterEach(() => vi.unstubAllGlobals());

function example(networkData = data, chunkPath = path) {
  const cache = new Map<string, Response>();
  const fetcher = vi.fn(async (url: URL | string) => (
    new URL(url).pathname === chunkPath ? new Response(networkData) : Response.json(manifest)
  ));
  vi.stubGlobal('location', new URL(base));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (url: string) => cache.get(url)?.clone(),
      put: async (url: string, value: Response) => { cache.set(url, value); },
      delete: async (url: string) => cache.delete(url),
    }),
  });
  return { cache, fetcher };
}

describe('verified model chunks', () => {
  it('replaces corrupted cached bytes, then serves a verified cache hit', async () => {
    const { cache, fetcher } = example();
    cache.set(base + path, new Response(new Uint8Array([0, 0, 0, 0])));
    const read = async () => new Uint8Array(await (await assetResponse('/model.json')).arrayBuffer());
    expect(await read()).toEqual(data);
    expect(await read()).toEqual(data);
    expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === path)).toHaveLength(1);
  });

  it('requires the pinned upscale manifest and reads from its own chunk root', async () => {
    const root = '/upscale-models';
    const chunkPath = path.replace('/bg-models', root);
    const { fetcher } = example(data, chunkPath);
    await expect(assetResponse(`${root}/model.json`, undefined, { root, sha256, bytes: 1 })).rejects.toThrow('Invalid model manifest');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const response = await assetResponse(`${root}/model.json`, undefined, { root, sha256, bytes: data.length });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(data);
    expect(new URL(fetcher.mock.calls.at(-1)![0]).pathname).toBe(chunkPath);
  });

  it('rejects same-length corrupted network bytes and outside origins', async () => {
    const { cache, fetcher } = example(new Uint8Array(4));
    await expect(assetResponse('https://elsewhere.test/model.json')).rejects.toThrow('same-origin');
    expect(fetcher).not.toHaveBeenCalled();
    await expect((await assetResponse('/model.json')).arrayBuffer()).rejects.toThrow('SHA-256');
    expect(cache.size).toBe(0);
  });
});
