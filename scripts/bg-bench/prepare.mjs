import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import models from './models.json' with { type: 'json' };
import { chunkBytes, weightsDir } from './paths.mjs';

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(path)) hash.update(block);
  return hash.digest('hex');
}

await mkdir(weightsDir, { recursive: true });
const requested = process.argv.slice(2);
for (const id of requested) {
  if (!models.some(model => model.id === id)) throw new Error(`Unknown model: ${id}`);
}

for (const model of models.filter(item => !requested.length || requested.includes(item.id))) {
  const destination = join(weightsDir, model.sha256);
  try {
    const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
    if (manifest.bytes === model.bytes && manifest.sha256 === model.sha256) {
      console.log(`${model.id} already staged`);
      continue;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const staged = await mkdtemp(join(weightsDir, 'staging-'));
  const local = process.env.BG_MODEL_DOWNLOADS;
  const source = local ? join(local, basename(model.url)) : join(staged, 'download.onnx');
  try {
    if (!local) {
      execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '2',
        '--max-time', '600', '--output', source, model.url], { stdio: 'inherit' });
    }
    if ((await stat(source)).size !== model.bytes || await sha256(source) !== model.sha256) {
      throw new Error(`${model.id} has unexpected bytes or SHA-256`);
    }
    const chunks = [];
    const file = await open(source, 'r');
    try {
      for (let offset = 0; offset < model.bytes; offset += chunkBytes) {
        const data = Buffer.alloc(Math.min(chunkBytes, model.bytes - offset));
        const { bytesRead } = await file.read(data, 0, data.length, offset);
        if (bytesRead !== data.length) throw new Error(`Short read for ${model.id}`);
        const name = `${chunks.length}.bin`;
        await writeFile(join(staged, name), data);
        chunks.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      }
    } finally {
      await file.close();
    }
    if (!local) await rm(source);
    await writeFile(join(staged, 'manifest.json'), JSON.stringify({ bytes: model.bytes, sha256: model.sha256, chunks }));
    await rename(staged, destination);
    console.log(`${model.id} staged in ${chunks.length} file(s)`);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}
