# Background removal with bg0

## Laptop test

1. Check out the PR and run `npm ci`. Use Node 24 and a recent Chromium-based browser for hardware WebGPU.
2. Run `npm run bg:assets -- lite full`. This build-time command fetches the two desktop tiers and verifies their pinned ONNX files. Use `npm run bg:assets` to include the iOS tier when testing it.
3. Run `npm run dev`, open [FileKit at localhost](http://localhost:3000/images/), and add a photo. A portrait with hair against white or clutter makes edge behavior easy to inspect.
4. Choose **Remove background** and **Apply remove background**. Watch the model tier, download size, and progress. Try **Cancel edit** during a cold download, then apply again. Chrome's DevTools Network panel should show same-origin worker assets and static chunks. On capable hardware the result shows **Full · WebGPU**. The compatibility path shows **Lite · WebGPU** or **Lite · WASM**.
5. Try **Transparent**, **Solid color**, and **Blur**. Choose dark green in the color picker to inspect hair edges. After each change, apply it and try Undo and Redo. Crop before or after removal and use Convert to export PNG, WebP, AVIF, or JPG. PNG, WebP, and AVIF preserve transparency. A transparent removal from an unconverted JPG defaults to PNG. JPG fills transparent pixels with the color chosen in Remove background.
6. For the direct comparison, run `npm run bg:prepare -- u2netp`, then `FILEKIT_BENCH=1 npm run bg:dev`. Open [the local benchmark](http://127.0.0.1:4310/dev/bg-bench) and choose **bg0 BiRefNet Full**, **bg0 BiRefNet Lite**, or **U²-Net-p**. Choose WebGPU on compatible hardware. The automated harness also works with `FILEKIT_BENCH=1 npm run bg:bench -- --models bg0-full,bg0-lite,u2netp --repeats 1`.

FileKit's normal static export omits the benchmark. The benchmark shows the same image, alpha, and checkerboard cutout for each model. bg0 predict timing includes bounded input preparation, model inference and refinement, then extraction of the alpha. U²-Net-p's legacy predict timing measures ORT inference and output readback. Compare quality visually and keep the timing methods in mind.

## First-use download

| Tier | Pinned model bytes | Model download | Initial model plus ONNX runtime* |
| --- | ---: | ---: | ---: |
| Full, desktop hardware WebGPU | 473,435,223 | 451.5 MiB | about 477.2 MiB |
| Lite, desktop/Android | 98,484,532 | 93.9 MiB | about 119.6 MiB |
| iOS Lite, quantized | 55,563,408 | 53.0 MiB | about 66.7 MiB |

*Before HTTP compression, excluding small model configs and FileKit's regular worker bundles. A browser using the plain WASM runtime downloads about 13.6 MiB of ONNX assets. A first-use Full failure can require the Lite model as well. A browser whose storage was cleared or whose cache is at quota can need a new download.

| Device | Input supplied to bg0 | FileKit export |
| --- | --- | --- |
| Desktop/laptop | At most 1,600 px on the long edge, 512 × 512 model input, quality refinement | Exact original dimensions after crop and rotation |
| Android | At most 1,024 px on the long edge, 512 × 512 Lite input, fast refinement | Exact original dimensions after crop and rotation |
| iOS and desktop-mode iPad | At most 1,280 px on the long edge, 512 × 512 quantized Lite input in bg0's separate worker | Original aspect ratio bounded to a 1,280 px source edge before crop and rotation |

## Upstream audit and patches

The npm registry exposed `@bg0/browser@0.1.1` during integration. That release only supplies the older one-checkpoint implementation and lacks the requested device tiers and iOS path. The repository vendors the upstream package declaring **0.1.2** from commit `a7a3e2b6dae9739a31c3560500c6b777fc25211f` as [an exact, lockfile-verified tarball](../vendor/bg0-browser-0.1.2.tgz). To rebuild it, compile the commit's `packages/browser/src/*.ts` (excluding `*.test.ts`) to `dist/` with TypeScript 5.9.3, ES2022 target, ESNext modules, bundler resolution, and declarations. Copy the iOS worker, manifest, and license texts under `dist/vendor/ios/`. Run `npm pack --ignore-scripts` in the package directory. Model and ONNX binaries are staged independently. The upstream HEIC fallback is omitted because FileKit always passes normalized PNG.

| Upstream behavior | FileKit adaptation |
| --- | --- |
| Hugging Face model download and jsDelivr WASM lookup | Set Transformers.js model host and runtime paths to FileKit. Route model reads through a SHA-256 verified chunk stream. Disable duplicate caching of the assembled graph. |
| DOM canvas in a Window | Use OffscreenCanvas in a disposable Comlink worker. The bounded input keeps model work independent of export dimensions. |
| Upstream allows Full on sufficiently large CPU-only machines | Use Lite when hardware WebGPU is unavailable. Full can be explicitly selected on the dev bench. |
| Crash marker uses Window storage | Keep the marker in the workspace while its Full worker is active. An interrupted Full run switches the next attempt to Lite. |
| Transformers.js chain can stay rejected after a failed GPU session | Carry upstream bg0's recovery patch for Transformers.js 4.3.0 so Lite can initialize and infer after failure. |
| Upstream product site uses analytics | FileKit integrates the library. The workspace performs local processing and makes only static same-origin GETs. |

The changes are applied by [patch-package](../patches) during `npm ci`. Dependency installation skips the optional native ONNX Runtime package downloads because FileKit uses the browser runtime. [Notices, licenses, and checkpoint provenance](../THIRD_PARTY_NOTICES.md).

Cloudflare Pages runs `npm run build` with its standard `CF_PAGES=1` setting. The build acquires trusted inputs and emits static assets under the FileKit origin. The build validates desktop ONNX files against Git LFS pointers at pinned upstream revisions and iOS against its pinned upstream manifest. The chunk manifest records SHA-256 and length for each chunk under 24 MiB. The browser checks cached and freshly read chunks, evicts corrupt entries, and retries from the same origin. The iOS acquisition URL is upstream's pinned-by-checksum review asset source. To stage previously archived inputs without the upstream hosts, set `FILEKIT_BG_ASSET_DIR` to a directory containing `lite.onnx`, `full.onnx`, their `<tier>.pointer` manifests and `<tier>-config.json` and `<tier>-preprocessor_config.json` files, and `int8-full-512.ort` for iOS.

## CI

PR #4's first push run failed in desktop WebKit at the redo shortcut while the prior preview was settling. This version registers keyboard handlers before the browser paints and waits for the enabled history control before sending Undo or Redo. FileKit also disables speculative route prefetch so Next does not make an extra HEAD request on the workspace. CI caches verified model assets, sets `FILEKIT_BG_E2E=1`, and exercises the desktop Lite graph in Chromium and the quantized iOS Lite graph in WebKit emulation through the static export with network observation. The local suite runs these real-model flows after staging Lite and setting the same flag. Set up the Playwright browser dependencies with `npx playwright install --with-deps chromium firefox webkit`. [PR #4 first push attempt](https://github.com/kim-mac/filekit/actions/runs/45673270421/attempts/1).
