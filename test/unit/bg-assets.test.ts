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
    const report = vi.fn();
    const read = async () => new Uint8Array(await (await assetResponse('/model.json', undefined, undefined, report)).arrayBuffer());
    expect(await read()).toEqual(data);
    expect(report.mock.calls).toEqual([[0, data.length, sha256, 0], [data.length, data.length, sha256, data.length]]);
    report.mockClear();
    expect(await read()).toEqual(data);
    expect(report).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === path)).toHaveLength(1);
  });

  it('aggregates streamed bytes across chunk boundaries and excludes cached bytes from the transfer rate', async () => {
    const { cache, fetcher } = example();
    const bytes = new Uint8Array([...data, ...data, ...data, ...data]);
    const modelHash = createHash('sha256').update(bytes).digest('hex');
    const chunk = (index: number) => `${base}/bg-models/chunks/${modelHash}/${index}.bin`;
    cache.set(chunk(0), new Response(data));
    cache.set(chunk(3), new Response(data));
    fetcher.mockImplementation(async url => {
      if (url === chunk(1) || url === chunk(2)) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(data.slice(0, 2));
            controller.enqueue(data.slice(2));
            controller.close();
          },
        }));
      }
      return Response.json({ bytes: bytes.length, sha256: modelHash, parts: Array(4).fill({ bytes: data.length, sha256 }) });
    });
    const report = vi.fn();
    expect(new Uint8Array(await (await assetResponse('/model.json', undefined, undefined, report)).arrayBuffer())).toEqual(bytes);
    expect(report.mock.calls.map(([loaded, total, id, received]) => [loaded, total, id, received])).toEqual(
      [[4, 0], [6, 2], [8, 4], [8, 4], [10, 6], [12, 8], [16, 8]]
        .map(([loaded, received]) => [loaded, bytes.length, modelHash, received]),
    );
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
