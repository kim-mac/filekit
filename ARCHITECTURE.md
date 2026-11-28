# FileKit architecture

FileKit is a privacy-first browser application for image, PDF, audio, and video tools. Phase 1 ships the image workspace. Phase 1a covers intake, conversion, and export. Phase 1b adds cached previews, crop, rotation, and flips. Phase 1c adds background removal. The image workspace also includes Blur and Upscale.

## Folder structure

```text
app/                         App Router layouts and routes
  page.tsx                   Home with Images, PDF, Audio, and Video cards
  images/page.tsx            Image workspace entry point
  globals.css                Tailwind CSS and shared styles
components/
  workspace/                 File list, preview, toolbar, history, and export
  ui/                        shadcn/ui primitives and shared form controls
lib/
  core/                      Tool contracts, category registry, edit history, and job types
  tools/
    image/
      index.ts               Image tool registration
      crop.tsx               Crop, rotate, and flip plugin
      convert.tsx            Output format and quality plugin
      remove-background.tsx  AI matte and background settings
  workers/
    image.worker.ts          Worker entry point and Comlink exposure
    image-client.ts          Typed Comlink proxy and worker lifecycle
    image/                   WASM decoding, pixel rendering, encoding, and ZIP
    bg0/                     Dedicated Comlink matte worker and verified asset transport
scripts/build-worker.mjs     Static module worker and lazy codec bundles
test/
  unit/                      Edit stack, registry, and tool apply tests
  golden/                    Golden-file assertions
  fixtures/                  Known and redistributable reference files
  e2e/                       Playwright smoke, workflow, privacy, and performance tests
  screenshots/               Mobile and desktop screenshot baselines
.github/workflows/test.yml    Test suite on every push and pull request
```

Use the Next.js App Router and TypeScript with `output: 'export'`. Cloudflare Pages builds with `npm run build` and serves `out/`. Routes generate static HTML. The interactive workspace runs in a Client Component. Prioritize desktop and laptop with larger previews, side panels, keyboard shortcuts, and the highest-quality models that the device can run. Mobile is supported with touch-friendly controls, accessible progress and errors, light and dark modes, and save-to-device downloads. Mobile may use lighter models, smaller inference inputs, or simpler controls. Show the active model quality and fall back on devices with limited memory or unavailable hardware acceleration.

For background removal, capable desktop hardware uses full BiRefNet through bg0 on WebGPU. Constrained devices and browsers without usable WebGPU use lite, with WASM fallback. The same-origin runtime caches verified model assets. Keep the non-destructive edit history and materialize output from the original decoded raster.

## Phase 1 workspace

- The home page links to the Images and PDF workspaces. Audio and Video remain marked **Coming soon**.
- The interface uses local shadcn/ui source components with Tailwind v4 tokens and monochrome system light/dark color schemes. Inter, icons and component scripts are served from FileKit.
- Desktop places Files directly below Preview and stacks Tools above Export at the side. Mobile orders Preview, Tools, Files and Export. The empty Preview opens the file picker and accepts drop or paste. After intake, a plus tile opens the picker and the whole workspace accepts drops. The horizontal strip uses bounded worker-generated Blob thumbnails and shows per-file status. Each ready file can download from its own edit history without changing the selection. Thumbnail actions appear on hover, on keyboard focus, and on touch.
- The Files strip stores order and optional output base names beside the edit stacks. Preview navigation and ZIP export use the same order. The worker adds the resolved format extension and disambiguates ZIP names before writing entries.
- The preview, comparison layers, and drawing tools share one zoom and pan transform. Fit uses the limiting canvas edge, and 100% uses the current image dimensions while displaying the bounded preview raster. Crop and blur use the transformed frame rectangle to map to normalized image coordinates. Two-finger gestures cancel a single-pointer edit in progress. Compare loads the original framing locally and uses the same transform for both layers.
- A debounced estimate encodes a sample up to 384 px on the long edge in a dedicated worker. The estimate uses encoded bytes directly for images at sample size and scales by pixel count for larger outputs. It uses padded row size for 24-bit BMP and the encoded icon bundle size for ICO. Crop estimates use the drawn bounds and Upscale estimates use the requested dimensions.
- Original details are read in the image worker from the local bytes. Only display fields and a location-present flag leave that worker. The UI shows no GPS coordinates, and export strips original metadata.
- Accept JPG, PNG, WebP, AVIF, GIF, and HEIC. Use the first frame of animated input and decode HEIC with `libheif-js`. Read EXIF orientation on decode and apply it once to the preview or export geometry.
- The Crop plugin provides a movable and resizable crop box with Pointer Events for mouse and touch. It offers free crop and 1:1, 4:5, 16:9, and 9:16 presets. Arrow keys move the focused box or resize the focused corner. In Crop, R and Shift+R rotate by 90°, H flips horizontally, and V flips vertically. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo applied edits.
- Export a single file or a ZIP of multiple results. Convert shows the decoded original format and defaults to Keep original format. HEIC input defaults to JPG. HEIC encoding is excluded because it is patent-encumbered and poorly supported in browsers. JPG, PNG, WebP, AVIF, static GIF, BMP, TIFF and ICO are available as output. ICO fits the image onto transparent squares and writes the selected 16, 32, 48, 64, 128 and 256 px entries into one file.
- A quality slider is available for JPG, WebP and AVIF. JPG and BMP export uses a separate fill color, default white, when the edited raster contains transparency. The preview retains alpha. Remove background owns only the appearance of the edited raster. Strip source EXIF from all outputs.
- Maintain per-file processing progress and actionable errors for unsupported, corrupt, canceled, or failed operations. Announce status changes to assistive technology and preserve focus around editing and export controls.

## Tool contract and registry

Each plugin supplies its UI, option defaults and validation, and implementation. The options panel edits draft options. Confirming a tool records a validated command in the file's history. A tool may prepare its options asynchronously with progress and cancellation before committing the command. The worker runs `apply` when it replays that history.

```ts
type Category = 'image' | 'pdf' | 'audio' | 'video';

interface ToolDefinition<Input, Options, Output, Context = undefined> {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  readonly OptionsPanel: ComponentType<{
    value: Options;
    context: Context;
    onChange: (options: Options) => void;
  }>;
  readonly defaultOptions: Options;
  parseOptions(value: unknown): Options;
  apply(input: Input, options: Options): Promise<Output>;
}

interface EditCommand {
  readonly toolId: string;
  readonly options: unknown;
}
```

The category registry lists tools in toolbar order, looks them up by stable ID, and rejects duplicate IDs or a category mismatch. The image registry registers Convert, Crop, Blur, Remove background, and Upscale. Add a tool by creating its plugin module and registering it. Open the options panel using the registry entry and resolve commands through the same registry in the worker. Keep plugin modules safe to import in the worker and load dependencies that need the DOM inside the UI path. Pass commands as plain structured-cloneable data.

Image plugins replay geometry and export settings. Crop composes source bounds and orientation. Convert updates the output format and quality. Remove background stores a compact matte and the background appearance. The matte maps to the EXIF-normalized original, so format, crop, and background can replay in either order. Blur records the geometry at each region edit. The pipeline materializes the final geometry from one raster after replay. The final export encodes once after replaying all edits, so undo, redo, and repeated export avoid cumulative quality loss.

## Edit history and rendering

```ts
interface EditStack {
  readonly original: File;
  readonly commands: readonly EditCommand[];
  readonly cursor: number;
}
```

Store an immutable original and a separate command history per file. Render the active prefix `commands.slice(0, cursor)`. Undo and redo move the cursor within the history bounds. Applying a new command after undo truncates the redo branch. Store crop bounds as normalized coordinates in the oriented frame at that point in the history. The worker rounds crop edges in full-resolution coordinates, composes the edit history, and projects the result onto the preview base. The preview displays the full-resolution output dimensions.

Cache the selected file’s orientation-normalized frame and an area-averaged preview base with a maximum edge of 2,048 px (at most 4,194,304 canvas pixels). Preview commands render from the base, and format, quality and export fill changes reuse the encoded raster preview. Encode large JPG previews at 95% quality when OffscreenCanvas is available. Evict the cache on selection change. Before validating another file or exporting, release the cached full-size raster and keep the selected preview base. Export materializes full-resolution edits from the original or a retained full-resolution AI stage derived from that original. Copy no source EXIF into the output. Use the relevant `@jsquash` WASM codecs on raw ImageData in the worker. GIF decode uses the Squoosh GIF codec. The same-origin ImageMagick WASM codec (14.77 MiB) loads on first GIF, BMP, TIFF or ICO export. It encodes GIF, BMP, TIFF and the PNG entries stored in ICO. Reserve canvas and OffscreenCanvas for previews. To stay below the iOS Safari canvas limit of approximately 16.7 MP, never send full-resolution images above 16,000,000 pixels through canvas. Use `fflate` for ZIP generation and feed finished files to the archive one at a time.

## Worker setup and privacy

```ts
interface ImageWorkerApi {
  retainPreview(id: string): void;
  renderPreview(request: PreviewRequest, onProgress: ProgressCallback): Promise<PreviewResult>;
  renderComparison(request: ComparisonRequest): Promise<Blob>;
  exportImage(request: ImageRequest, onProgress: ProgressCallback): Promise<ImageExport>;
  exportZip(request: readonly ImageRequest[], onProgress: ProgressCallback): Promise<ZipResult>;
  // The client cancels by terminating the worker and settling the active job.
}
```

Build the image worker as a code-split ES module under `public/workers/` before building or running Next.js. Instantiate it with `new Worker(new URL('/workers/image.worker.js', window.location.origin), { type: 'module' })`. Use Comlink `wrap` in the client, `expose` in the worker, and `proxy` for progress callbacks. Requests include file IDs, original file references, command snapshots, and the preview bounds. Pass File or Blob references through structured clone and transfer ArrayBuffers when ownership can move. Return preview or output blobs without sending decoded full-size pixel buffers to the UI.

Serialize full-resolution work and process batch files one at a time. Prioritize the active preview and discard results from superseded edits. The client cancels active WASM calls by terminating the worker and supersedes previews when the selection changes. Ignore responses belonging to canceled or superseded jobs. Release bitmaps, temporary pixel buffers, callbacks, and object URLs when the job or UI no longer needs them. The 6000 × 4000 fixture accounts for the following worker memory during export.

| Live raster storage for the 6000 × 4000 fixture | Bytes | MiB |
| --- | ---: | ---: |
| One decoded RGBA raster | 96,000,000 | 91.55 |
| Cached 2048 × 1365 preview base | 11,182,080 | 10.66 |
| Non-square transpose scratch, one bit per pixel | 3,000,000 | 2.86 |
| Plain export raster subtotal | 107,182,080 | 102.22 |
| Quarter-turn export raster subtotal | 110,182,080 | 105.08 |

A new full-size transposed raster would use 91.55 MiB. Export composes EXIF with the edits before applying the final orientation in place. JPG, PNG, and WebP crops over one quarter of the source area compact rows in place. Smaller crops allocate a compact raster and release the source before encoding. AVIF crops use a separate tightly packed raster because its codec wrapper reads the entire backing buffer.

Raster subtotals count live buffers owned by FileKit. The browser, compressed blobs, GPU surfaces, and WASM linear memory add to process memory. The Chromium performance test also logs the Linux renderer high-water RSS before intake and after plain and rotated exports. RSS includes earlier work and the browser runtime. Mobile profiles run on the desktop test host.

Bundle scripts, Inter, worker modules, and WASM as same-origin static assets. Cloudflare Pages, Next development and the static preview server serve COOP `same-origin`, COEP `require-corp`, and CORP `same-origin` site-wide. This enables shared WASM memory. The preview server uses Last-Modified because serve omits isolation headers on ETag-based 304 responses and WebKit then blocks the worker module. ONNX uses up to eight threads on desktop and two on mobile when shared memory is available. The bundled AVIF encoder uses its threaded build when supported, including its same-origin pthread module. The bundled JPG, PNG and WebP encoders use their existing single-thread builds. Load each WASM codec on first use from same-origin static assets. Allow same-origin GET requests for bundled JS, WASM, and verified static model assets. Reject any request to an external domain, any request with a body, and any request whose URL contains file names or file data. Keep all file data, names, metadata, previews, and results in the browser. Generate downloads from local blobs. The app has zero uploads, API routes, accounts, or tracking.

## Region blur

The Blur plugin records brush and eraser paths, rectangles, and ellipses as normalized coordinates in the oriented frame at the time of editing. Brush diameter scales with the shorter edge. The worker projects the edit’s geometry onto the preview or export raster and applies its mask through a strided view of the original. Crops, rotations, and flips before a blur define its frame. Later geometry carries the modified pixels along. Undo and redo replay the active command prefix. Background masks keep their source coordinates and the latest background replacement takes effect at its position among the blur commands.

The worker builds a one-bit mask and applies either origin-aligned pixelation or a Gaussian approximation using three separable box filters with running sums. Strength and block size scale with the image. The effect preserves alpha and weights neighboring colors by alpha. Gaussian scratch storage uses two one-byte planes for opaque input and an additional one-byte plane for transparency. A fully selected 6000 × 4000 opaque image needs 48 MB of scratch in addition to the decoded raster and cached preview base. A region mask uses at most 3 MB at that size. Blur has full-resolution export on both desktop and mobile.

Drafts and committed previews share the raster renderer. The image worker returns a transferable, bounded ImageData to the editor while the user draws. Full-resolution export replays those edits against the decoded original through the WASM codec path. Two-finger touch gestures cancel any in-progress stroke and pan or zoom the editor.

The Detect faces button starts a dedicated worker with a preview of the current frame. The worker lazily fetches and verifies the same-origin YuNet weights and uses the shared ONNX Runtime Web WASM assets for inference. It caches the most recent set of normalized boxes for the selected file, committed edit prefix and YuNet checkpoint. The user can adjust or remove those boxes before applying the edit. Export replays the saved regions. [Model provenance and license](THIRD_PARTY_NOTICES.md#face-detection).

## Background removal

A disposable Comlink worker invokes the pinned bg0 library. FileKit decodes the original with its existing codecs, makes a bounded PNG for inference, and releases the original raster ahead of the bg0 session. Capable desktops choose Full on hardware WebGPU. Lite is available on WebGPU or WASM, and iOS uses bg0's dedicated quantized Lite worker. The device remembers Auto, Best quality, or Fast. Best quality and Fast pin the corresponding bg0 tier. iOS runs quantized Lite. Failed Full runs fall back to Lite, and the panel reports the model that produced the matte. A tab marker enables Lite after an interrupted Full run. Canceling tears down the dedicated worker and preserves the current edit history.

The desktop PNG sent to bg0 is capped at 1,600 px on the long edge and uses bg0's quality refinement. Android and iOS use smaller inference inputs and fast refinement. The stored alpha is a bounded grayscale Blob. Preview and export guide its upscale with the source RGB and unmix nearby background colors at partially transparent edges. Transparent, solid, and blurred backgrounds reuse the same source-space matte. The selected file keeps its latest successful matte for the bg0 model policy and preprocessing options. A committed background edit embeds its compact alpha in history for export. Desktop and Android encode the original edited pixel dimensions. For background removal on the original stage, iOS caps the EXIF-normalized source at a 1,280 px long edge before replay. The control panel displays the active tier and the applicable cap.

The Cloudflare build downloads pinned weights as build inputs and publishes only same-origin assets. It splits large model and runtime assets into files below 24 MiB. The browser checks each chunk against SHA-256 before caching or use. The separately launched benchmark requires `FILEKIT_BENCH=1` and stays outside the Next export. [Integration, data sizes, and laptop testing](docs/bg0-integration.md).

The shared model notice reports model bytes and estimates the remaining time from network bytes received. Cached chunks count toward the completed model without affecting the transfer rate. A fully cached model skips the download notice. Processing reports tiles or named steps with elapsed time.

## Upscale

Upscale records a 2× or 4× operation in the edit stack. In the worker, each upscale consumes the full-resolution raster from all earlier geometry and raster edits. The following crop, rotation and blur operations then use the scaled dimensions. Remove background keeps the latest settings and samples its original-space matte through any earlier crop, rotation and upscale. A background edit applied after Upscale uses the scaled dimensions on iOS as well. Convert still encodes only once, after replay. The worker retains the latest post-inference stage for the selected file. Its key includes the raster edit prefix, inference options and checkpoint hashes. Conversion and later raster edits can share it. Export replays the remaining edits on the retained full-resolution result and copies pixels before any operation that would mutate that result. A cache miss replays from the decoded original. The full-resolution cache holds one stage up to 96 MiB on desktop, 32 MiB on mobile or a device reporting at most 4 GiB of RAM, and 16 MiB on a device reporting at most 2 GiB. Beyond that budget the worker retains only the bounded preview. Changing files evicts the working raster and inference caches. Committed mattes and accepted face regions remain part of edit history.

Photo uses Real-ESRGAN General and Graphics uses Real-ESRGAN Anime. Desktop tries hardware WebGPU, then restarts the current inference with WASM if WebGPU fails. Mobile uses smaller WASM tiles and a smaller thread pool. A tile reads its overlap plus the model's full receptive-field halo. The worker feathers RGB across neighbors into the output raster and interpolates alpha independently. The native model runs at 4×. A 2× edit averages 2×2 output samples during compositing and avoids allocating an intermediate 4× raster. Upscale caps the output at 64 MP on desktop and 16 MP on mobile. The per-side limits are 16,380 px and 8,192 px, respectively.

Applying Upscale runs a tentative edit in the image worker with per-tile progress. Cancel terminates that worker and the command remains uncommitted. The model loader uses the shared verified-chunk transport and pins both the expected byte length and SHA-256 in the worker bundle. The static export serves model files as content-addressed chunks below 24 MiB and the browser re-verifies cached chunks. [Model choice and timings](docs/upscale-eval.md)

## PDF workspace

The PDF route uses the same workspace layout, file strip, tool registry, progress, and download controls as Images. Each document holds stable references to original pages, images, and blank page sizes. The shared edit stack tracks page operations and replays the current history on export. Merge builds a draft from the Files strip order. Dragging a page onto another PDF copies the selected pages to its end. The Merge panel provides a keyboard and touch alternative.

The Comlink worker lazy-loads PDF.js on first intake or preview. PDF.js parses in its own same-origin worker and draws in the Comlink worker. The grid renders visible thumbnails serially, retains a bounded set of 48 thumbnail blobs, and revokes object URLs when thumbnails leave the grid. The worker keeps up to two parsed PDFs within a 48 MiB source budget, with room for one active original above that budget. Fonts, CMaps, ICC profiles, and decoder WASM are packaged with PDF.js and loaded on demand. QPDF WASM unlocks encrypted documents in local memory after PDF.js validates the password. Exports of unlocked documents are unencrypted.

The export worker uses pdf-lib to reuse vector and text content. It retains the primary document catalog when all of its pages remain, remaps internal links and bookmarks when copying pages, and removes unreachable PDF objects after extraction. Imported form pages retain their appearances when possible. Export preserves primary metadata by default and offers an option to remove PDF Info and XMP metadata. Image inputs use the same EXIF-aware WASM decoders as Images. For PDF to images, PDF.js renders tiles into a pixel buffer and the existing WASM codecs write PNG, JPG, or WebP. Mobile limits each image to 16 MP and 8,192 pixels per side. Desktop preserves the selected DPI up to 64 MP and 16,380 pixels per side, with an error prompting a lower DPI for larger pages. Multi-file exports stream completed files into a ZIP.

## Testing plan

Run `npm ci`, `npx playwright install --with-deps chromium firefox webkit`, and `npm run test:all`. The last command runs Vitest, builds the static export, then serves `out/` locally for Playwright. CI stages the pinned model assets through a keyed dependency cache, sets `FILEKIT_BG_E2E=1`, and runs the same command on every push and pull request.

| Suite | Phase 1 coverage |
| --- | --- |
| Vitest unit | Edit stack boundaries, redo branch truncation, per-file isolation, registry lookup and validation, and each plugin's `apply()`, including error cases. |
| Golden files | Use reference JPG, PNG, WebP, HEIC, AVIF, and animated GIF inputs plus a 6000 × 4000 image and a transparent PNG in `test/fixtures`. Verify output signatures and MIME types, decodability, dimensions, alpha handling, GIF first frame, EXIF orientation and stripping, and exported ZIP contents. Compare decoded pixels with a tolerance for lossy formats. Load codec WASM from disk in Vitest and exercise browser-specific decode and worker paths in Playwright with the same fixtures. |
| Playwright | Chromium, Firefox, and WebKit on desktop, with iPhone WebKit and Android Chromium touch emulation. Exercise picker, drop, paste, multiple files, conversion, crop presets, pointer resizing, rotation, flips, progress, errors, and single and ZIP download. Cover keyboard editing and history on desktop and touch controls on mobile. |
| Privacy | Start network observation before page initialization. Block service workers. Fail on any request to an external domain, any request with a body, or any request whose URL contains fixture filenames or file data. Allow same-origin GET requests for bundled JS, WASM, and verified static model assets. Check downloaded files still succeed. |
| Screenshots | Capture each screen and its key states at mobile and desktop sizes in `test/screenshots`, using stable fixtures, self-hosted Inter, and Playwright screenshot assertions after `document.fonts.ready`. |
| Performance | Run a 6000 × 4000 image through preview and export on desktop and mobile emulation. Assert a responsive workspace, job completion, and full output dimensions after a format-only edit. Log the first preview, repeated conversion previews, rotated preview, and export timing per project. Enforce the 300 ms repeat-preview target on desktop Chromium and log its export memory high-water marks. |
