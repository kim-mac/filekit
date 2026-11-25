import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import fixtures from '../../test/fixtures/bg/fixtures.json' with { type: 'json' };
import models from './models.json' with { type: 'json' };
import { fixturesDir, here, ortDir, weightsDir } from './paths.mjs';

const root = '/dev/bg-bench';
const types = {
  bin: 'application/octet-stream', html: 'text/html; charset=utf-8', jpg: 'image/jpeg',
  js: 'text/javascript', json: 'application/json', mjs: 'text/javascript', png: 'image/png', wasm: 'application/wasm',
};

export async function startServer(port = 0) {
  const output = join(here, 'bundle');
  const buildOutput = await build({
    entryPoints: [join(here, 'page.ts'), join(here, 'worker.ts')],
    outdir: output,
    bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022', write: false,
  });
  const bundles = new Map(buildOutput.outputFiles.map(file => [
    `${root}/bundle${file.path.slice(output.length)}`, file.contents,
  ]));
  const files = new Map([[root, join(here, 'index.html')]]);
  for (const [index, fixture] of fixtures.entries()) {
    files.set(`${root}/fixtures/${index}/image`, join(fixturesDir, fixture.image));
    if (fixture.mask) files.set(`${root}/fixtures/${index}/alpha`, join(fixturesDir, fixture.mask));
  }
  for (const stem of ['ort-wasm-simd-threaded', 'ort-wasm-simd-threaded.asyncify']) {
    for (const ext of ['mjs', 'wasm']) {
      files.set(`${root}/ort/${stem}.${ext}`, join(ortDir, `${stem}.${ext}`));
    }
  }
  const hashes = new Set(models.map(model => model.sha256));
  const server = createServer(async (request, response) => {
    const url = request.url ?? '';
    if (request.method !== 'GET' || request.headers['content-length'] || request.headers['transfer-encoding']) {
      response.writeHead(405).end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob:; style-src 'unsafe-inline'");
    if (bundles.has(url)) {
      response.writeHead(200, { 'Content-Type': types.js }).end(bundles.get(url));
      return;
    }
    const weight = /^\/dev\/bg-bench\/weights\/([a-f0-9]{64})\/(manifest\.json|\d+\.bin)$/.exec(url);
    const path = files.get(url) ?? (weight && hashes.has(weight[1]) ? join(weightsDir, weight[1], weight[2]) : null);
    if (path) {
      try {
        const { size } = await stat(path);
        response.writeHead(200, { 'Content-Type': types[path.split('.').at(-1)], 'Content-Length': size });
        const stream = createReadStream(path);
        stream.on('error', error => response.destroy(error));
        response.on('close', () => stream.destroy());
        stream.pipe(response);
        return;
      } catch (error) {
        if (error.code !== 'ENOENT') console.error(error);
      }
    }
    response.writeHead(404).end('Unknown benchmark asset. Run npm run bg:prepare to stage weights.');
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}${root}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.env.BG_BENCH_PORT ?? 4310));
  console.log(url);
}
