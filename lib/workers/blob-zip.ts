import { Zip, ZipPassThrough } from 'fflate';

export function createBlobZip() {
  const chunks: Blob[] = [];
  const zip = new Zip((error, data) => {
    if (error) throw error;
    chunks.push(new Blob([data as Uint8Array<ArrayBuffer>]));
  });
  return {
    async add(name: string, blob: Blob) {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      // Retain the archive and one encoded file at a time.
      const reader = blob.stream().getReader();
      try {
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) entry.push(chunk.value);
        entry.push(new Uint8Array(0), true);
      } finally {
        reader.releaseLock();
      }
    },
    finish() {
      zip.end();
      return new Blob(chunks, { type: 'application/zip' });
    },
  };
}
