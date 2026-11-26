import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const transformers = createRequire(require.resolve('@huggingface/transformers'));
const onnxWasm = dirname(transformers.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));

const outdir = 'public/workers';
await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: {
    'image.worker': 'lib/workers/image.worker.ts',
    'background.worker': 'lib/workers/bg0/background.worker.ts',
    'faces.worker': 'lib/workers/image/faces.worker.ts',
    // AVIF's pthread loader imports this stable sibling URL.
    'avif_enc_mt': require.resolve('@jsquash/avif/codec/enc/avif_enc_mt.js'),
  },
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: ['es2022', 'safari16.4'],
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  assetNames: '[name]-[hash]',
  chunkNames: '[name]-[hash]',
  plugins: [{
    name: 'shared-onnx-runtime',
    setup(builder) {
      // Use the same ORT release as the static background runtime assets.
      // These frontends load their runtime on demand.
      builder.onResolve({ filter: /^onnxruntime-web\/(wasm|webgpu)$/ }, ({ importer, path }) => {
        if (!/\/(faces|inference)\.ts$/.test(importer)) return;
        const frontend = path.split('/').at(-1);
        return { path: resolve(onnxWasm, `ort.${frontend}.min.mjs`) };
      });
    },
  }, {
    name: 'wasm-codec-assets',
    setup(builder) {
      // Emscripten and wasm-bindgen locate their binaries relative to the
      // original module. Keep those URLs valid after code splitting.
      builder.onLoad({ namespace: 'file', filter: /node_modules\/(@jsquash|@discourse)\/[^/]+\/codec\/.*\.(js|mjs)$/ }, async ({ path }) => {
        let source = await readFile(path, 'utf8');
        const imports = [];
        if (path.endsWith('/avif_enc_mt.js')) {
          const threads = resolve('lib/workers/wasm-threads.mjs');
          imports.push(`import { wasmThreads } from ${JSON.stringify(threads)};`);
          source = source.replace(/navigator(?:\.hardwareConcurrency|\["hardwareConcurrency"\])/g, 'wasmThreads()');
        }
        const contents = source.replace(
          /new URL\((['"])([\w.-]+\.(?:wasm|worker\.mjs))\1,\s*import\.meta\.url\)/g,
          (_, _quote, file) => {
            const name = `codecAsset${imports.length}`;
            imports.push(`import ${name} from "codec-asset:${file}";`);
            return `new URL(${name}, import.meta.url)`;
          },
        );
        return { contents: [...imports, contents].join('\n'), resolveDir: dirname(path) };
      });
      builder.onResolve({ filter: /^codec-asset:/ }, ({ path, resolveDir }) => ({
        path: resolve(resolveDir, path.slice('codec-asset:'.length)),
        namespace: 'codec-asset',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'codec-asset' }, async ({ path }) => ({
        contents: await readFile(path),
        loader: 'file',
      }));
    },
  }],
});
