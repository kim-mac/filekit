import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const transformers = createRequire(require.resolve('@huggingface/transformers'));
const ortDist = dirname(transformers.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
const iosPackage = join(dirname(require.resolve('@bg0/browser')), 'vendor/ios');
const work = '.cache/bg0-assets';
const publicRoot = 'public';
const chunkSize = 23 * 2 ** 20;
const models = {
  lite: { repository: 'studioludens/birefnet-lite-512', revision: '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7',
    bytes: 98_484_532, sha256: 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516' },
  full: { repository: 'naddy24/birefnet-512-webgpu', revision: 'ca02a86c094927479e2be583abe87f8ea73fcfda',
    bytes: 473_435_223 },
};
const args = process.argv.slice(2);
if (args.includes('--pages') && process.env.CF_PAGES !== '1') process.exit(0);
const runtimeOnly = args.includes('--runtime-only');
const selected = runtimeOnly ? [] : args.length && !args.includes('--pages') ? args : ['lite', 'full', 'ios'];
for (const filename of ['bg0-Apache-2.0.txt', 'BiRefNet-MIT.txt', 'Transformers-Apache-2.0.txt',
  'ONNX-Runtime-MIT.txt', 'ONNX-Runtime-ThirdPartyNotices.txt']) {
  await copy(join('licenses/bg0', filename), join(publicRoot, 'licenses', filename));
}
await copy('licenses/upscale/Real-ESRGAN-BSD-3-Clause.txt', join(publicRoot, 'licenses/Real-ESRGAN-BSD-3-Clause.txt'));
await copy('licenses/inter/Inter-OFL.txt', join(publicRoot, 'licenses/Inter-OFL.txt'));
await copy('THIRD_PARTY_NOTICES.md', join(publicRoot, 'licenses/THIRD_PARTY_NOTICES.md'));
await copy('LICENSE', join(publicRoot, 'licenses/FileKit-MIT.txt'));

for (const tier of selected) {
  if (tier !== 'ios' && !Object.hasOwn(models, tier)) throw new Error(`Unknown model tier ${tier}`);
}

function curl(url, output) {
  const flags = ['--fail', '--silent', '--show-error', '--location', '--retry', '3', '--connect-timeout', '15', '--max-time', '900'];
  return execFileSync('curl', [...flags, ...(output ? ['--output', output] : []), url],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

async function write(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function digestFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function validated(file, bytes, sha256) {
  try { return (await stat(file)).size === bytes && await digestFile(file) === sha256; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function acquire(url, filename, bytes, sha256) {
  const supplied = process.env.FILEKIT_BG_ASSET_DIR;
  const file = supplied ? join(supplied, filename) : join(work, 'downloads', filename);
  if (await validated(file, bytes, sha256)) return file;
  if (supplied) throw new Error(`${file} is missing or failed its pinned length/SHA-256 check`);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.download`;
  try {
    curl(url, temp);
    if (!await validated(temp, bytes, sha256)) throw new Error(`Unexpected bytes or SHA-256 for ${filename}`);
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
  return file;
}

async function stageChunks(file, bytes, sha256, manifestPath) {
  const source = await open(file, 'r');
  const parts = [];
  const dir = join(publicRoot, 'bg-models/chunks', sha256);
  await mkdir(dir, { recursive: true });
  try {
    for (let start = 0; start < bytes; start += chunkSize) {
      const buf = Buffer.alloc(Math.min(chunkSize, bytes - start));
      const { bytesRead } = await source.read(buf, 0, buf.length, start);
      if (bytesRead !== buf.length) throw new Error(`Short read from ${file}`);
      parts.push({ bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
      await writeFile(join(dir, `${parts.length - 1}.bin`), buf);
    }
  } finally {
    await source.close();
  }
  await write(manifestPath, JSON.stringify({ bytes, sha256, parts }));
}

async function stageModel(tier) {
  const { repository, revision, bytes, sha256: expectedDigest } = models[tier];
  const hub = `https://huggingface.co/${repository}`;
  const raw = `${hub}/raw/${revision}`;
  const resolve = `${hub}/resolve/${revision}`;
  const model = 'onnx/model_fp16.onnx';
  const dir = join(publicRoot, 'bg-model-source', repository, 'resolve', revision);
  // The Git LFS pointer belongs to the immutable upstream commit. It supplies
  // the checksum independently of the redirected model download.
  const metadata = join(work, 'source', repository, revision);
  const supplied = process.env.FILEKIT_BG_ASSET_DIR;
  async function text(path, suppliedName) {
    const local = supplied ? join(supplied, suppliedName) : join(metadata, path);
    try { return await readFile(local, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT' || supplied) throw error; }
    const content = curl(`${raw}/${path}`);
    await write(local, content);
    return content;
  }
  const pointer = await text(model, `${tier}.pointer`);
  const sha256 = /^oid sha256:([a-f0-9]{64})$/m.exec(pointer)?.[1];
  if (!sha256 || (expectedDigest && sha256 !== expectedDigest) || !pointer.startsWith('version https://git-lfs.github.com/spec/v1') ||
    Number(/^size (\d+)$/m.exec(pointer)?.[1]) !== bytes) {
    throw new Error(`The immutable ${tier} model pointer has unexpected metadata`);
  }
  const file = await acquire(`${resolve}/${model}`, `${tier}.onnx`, bytes, sha256);
  for (const name of ['config.json', 'preprocessor_config.json']) {
    const config = JSON.parse(await text(name, `${tier}-${name}`));
    await write(join(dir, name), JSON.stringify(config));
  }
  await stageChunks(file, bytes, sha256, join(dir, `${model}.json`));
  console.log(`Staged bg0 ${tier}, ${bytes} model bytes (${sha256})`);
}

const runtime = join(publicRoot, 'bg-runtime');
const asyncify = 'ort-wasm-simd-threaded.asyncify';
const plain = 'ort-wasm-simd-threaded';
for (const filename of [`${asyncify}.mjs`, `${plain}.mjs`, `${plain}.wasm`]) {
  await copy(join(ortDist, filename), join(runtime, 'onnx', filename));
}
const asyncWasm = join(ortDist, `${asyncify}.wasm`);
await stageChunks(asyncWasm, (await stat(asyncWasm)).size, await digestFile(asyncWasm),
  join(runtime, 'onnx', `${asyncify}.wasm.json`));

const ios = join(runtime, 'ios');
const iosManifest = JSON.parse(await readFile(join(iosPackage, 'manifest.json'), 'utf8'));
for (const [filename, expected] of Object.entries(iosManifest.files)) {
  if (filename.endsWith('.ort')) continue;
  const source = join(ortDist, filename);
  if (!await validated(source, expected.bytes, expected.sha256)) throw new Error(`Unexpected iOS runtime asset ${filename}`);
  await copy(source, join(ios, filename));
}
for (const filename of ['worker.mjs', 'BiRefNet-LICENSE.txt', 'ONNX-Runtime-LICENSE.txt', 'ONNX-Runtime-ThirdPartyNotices.txt']) {
  await copy(join(iosPackage, filename), join(ios, filename));
}
await copy('lib/workers/bg0/asset-stream.mjs', join(ios, 'asset-stream.mjs'));
await copy('lib/workers/wasm-threads.mjs', join(ios, 'wasm-threads.mjs'));

for (const tier of selected) {
  if (tier !== 'ios') {
    await stageModel(tier);
    continue;
  }
  const name = 'int8-full-512.ort';
  const { bytes, sha256 } = iosManifest.files[name];
  const source = await acquire(`https://bg0-mobile-preview.vercel.app/birefnet-test/assets/${name}`, name, bytes, sha256);
  await stageChunks(source, bytes, sha256, join(ios, `${name}.json`));
  console.log(`Staged bg0 iOS Lite, ${bytes} model bytes (${sha256})`);
}
