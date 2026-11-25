const cacheName = 'filekit-bg-assets-v1';

async function openCache() {
  try {
    return await globalThis.caches?.open(cacheName);
  } catch {
    return undefined;
  }
}

async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifiedChunk(url, part, cache, signal) {
  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    if (bytes.byteLength === part.bytes && await digest(bytes) === part.sha256) return bytes;
    await cache.delete(url).catch(() => undefined);
  }
  const response = await fetch(url, { signal, redirect: 'error', mode: 'same-origin' });
  if (!response.ok) throw new Error(`Model chunk unavailable (HTTP ${response.status}).`);
  const data = await response.arrayBuffer();
  if (data.byteLength !== part.bytes || await digest(data) !== part.sha256) {
    throw new Error('Model chunk failed SHA-256 verification.');
  }
  // Cache writes are best effort and can fail in private mode or at quota.
  await cache?.put(url, new Response(data)).catch(() => undefined);
  return data;
}

export async function assetResponse(manifestUrl, signal) {
  const url = new URL(manifestUrl, globalThis.location.href);
  if (url.origin !== globalThis.location.origin) throw new Error('The model manifest must be same-origin.');
  const response = await fetch(url, { signal, redirect: 'error', mode: 'same-origin' });
  if (!response.ok) throw new Error(`Background-removal assets unavailable (HTTP ${response.status}).`);
  const { bytes, sha256, parts } = await response.json();
  const hash = /^[a-f0-9]{64}$/;
  if (!hash.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 1 || !Array.isArray(parts) ||
    parts.some(part => !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes >= 24 * 1024 * 1024 ||
      !hash.test(part.sha256)) || parts.reduce((total, part) => total + part.bytes, 0) !== bytes) {
    throw new Error('Invalid background-removal manifest.');
  }

  const cache = await openCache();
  let index = 0;
  const local = new AbortController();
  const requestSignal = signal ? AbortSignal.any([local.signal, signal]) : local.signal;
  return new Response(new ReadableStream({
    async pull(controller) {
      if (index >= parts.length) {
        controller.close();
        return;
      }
      const partUrl = new URL(`/bg-models/chunks/${sha256}/${index}.bin`, url).href;
      const part = parts[index++];
      const data = await verifiedChunk(partUrl, part, cache, requestSignal);
      if (!requestSignal.aborted) controller.enqueue(new Uint8Array(data));
      else controller.error(requestSignal.reason);
    },
    cancel(reason) {
      local.abort(reason);
    },
  }), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes) } });
}
