import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const outdir = 'public/workers';
await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: { 'image.worker': 'lib/workers/image.worker.ts' },
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
    name: 'wasm-codec-assets',
    setup(builder) {
      // Emscripten and wasm-bindgen locate their binaries relative to the
      // original module. Keep those URLs valid after code splitting.
      builder.onLoad({ namespace: 'file', filter: /node_modules\/(@jsquash|@discourse)\/[^/]+\/codec\/.*\.(js|mjs)$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const imports = [];
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
