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

async function verifiedChunk(url, part, cache, signal, report) {
  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    if (bytes.byteLength === part.bytes && await digest(bytes) === part.sha256) return bytes;
    await cache.delete(url).catch(() => undefined);
  }
  report?.(0);
  const response = await fetch(url, { signal, redirect: 'error', mode: 'same-origin' });
  if (!response.ok) throw new Error(`Model chunk unavailable (HTTP ${response.status}).`);
  const data = report && response.body
    ? await readDownload(response.body, part.bytes, report)
    : await response.arrayBuffer();
  if (data.byteLength !== part.bytes || await digest(data) !== part.sha256) {
    throw new Error('Model chunk failed SHA-256 verification.');
  }
  // Cache writes are best effort and can fail in private mode or at quota.
  await cache?.put(url, new Response(data)).catch(() => undefined);
  report?.(part.bytes);
  return data;
}

async function readDownload(body, bytes, report) {
  const buffer = new Uint8Array(bytes);
  const reader = body.getReader();
  let loaded = 0;
  let lastReported = 0;
  let lastReportTime = Date.now();
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      if (loaded + chunk.value.byteLength > bytes) throw new Error('Model download exceeded its expected size.');
      buffer.set(chunk.value, loaded);
      loaded += chunk.value.byteLength;
      const now = Date.now();
      if (loaded < bytes && (loaded - lastReported >= Math.max(1, bytes / 25) || now - lastReportTime >= 2000)) {
        report(loaded);
        lastReported = loaded;
        lastReportTime = now;
      }
    }
    if (loaded !== bytes) throw new Error('Model download ended before it was complete.');
    return buffer.buffer;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function verifiedAsset(path, expected, report) {
  const url = new URL(path, globalThis.location.href);
  if (url.origin !== globalThis.location.origin) throw new Error('Model assets must be same-origin.');
  return verifiedChunk(url.href, expected, await openCache(), undefined, report);
}

export async function assetResponse(manifestUrl, signal, expected, report) {
  const url = new URL(manifestUrl, globalThis.location.href);
  if (url.origin !== globalThis.location.origin) throw new Error('The model manifest must be same-origin.');
  const response = await fetch(url, { signal, redirect: 'error', mode: 'same-origin' });
  if (!response.ok) throw new Error(`Model assets unavailable (HTTP ${response.status}).`);
  const { bytes, sha256, parts } = await response.json();
  const hash = /^[a-f0-9]{64}$/;
  if (!hash.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 1 || !Array.isArray(parts) ||
    parts.some(part => !part || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes >= 24 * 1024 * 1024 ||
      !hash.test(part.sha256)) || parts.reduce((total, part) => total + part.bytes, 0) !== bytes ||
    (expected && (expected.bytes !== bytes || expected.sha256 !== sha256))) {
    throw new Error('Invalid model manifest.');
  }

  const cache = await openCache();
  let index = 0;
  let loaded = 0;
  let reportedBytes;
  let received = 0;
  const local = new AbortController();
  const abort = () => local.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const detach = () => signal?.removeEventListener('abort', abort);
  return new Response(new ReadableStream({
    async pull(controller) {
      if (index >= parts.length) {
        detach();
        controller.close();
        return;
      }
      const partUrl = new URL(`${expected?.root ?? '/bg-models'}/chunks/${sha256}/${index}.bin`, url).href;
      const part = parts[index++];
      try {
        let partReceived = 0;
        const data = await verifiedChunk(partUrl, part, cache, local.signal, report && (current => {
          received += current - partReceived;
          partReceived = current;
          reportedBytes = loaded + current;
          report(reportedBytes, bytes, sha256, received);
        }));
        loaded += part.bytes;
        local.signal.throwIfAborted();
        if (reportedBytes !== undefined && reportedBytes !== loaded && index === parts.length) {
          report?.(loaded, bytes, sha256, received);
        }
        controller.enqueue(new Uint8Array(data));
      } catch (error) {
        detach();
        controller.error(error);
      }
    },
    cancel(reason) {
      detach();
      local.abort(reason);
    },
  }), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes) } });
}
