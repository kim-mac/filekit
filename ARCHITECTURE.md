# FileKit architecture

FileKit is a privacy-first browser application for image, PDF, audio, and video tools. Phase 1 ships the image workspace. Phase 1a covers intake, conversion, and export. Phase 1b adds cached previews, crop, rotation, and flips.

## Folder structure

```text
app/                         App Router layouts and routes
  page.tsx                   Home with Images, PDF, Audio, and Video cards
  images/page.tsx            Image workspace entry point
  globals.css                Tailwind CSS and shared styles
components/
  workspace/                 File list, preview, toolbar, history, and export
  ui/                        Shared accessible controls
lib/
  core/                      Tool contracts, category registry, edit history, and job types
  tools/
    image/
      index.ts               Image tool registration
      crop.tsx               Crop, rotate, and flip plugin
      convert.tsx            Output format and quality plugin
  workers/
    image.worker.ts          Worker entry point and Comlink exposure
    image-client.ts          Typed Comlink proxy and worker lifecycle
    image/                   WASM decoding, pixel rendering, encoding, and ZIP
scripts/build-worker.mjs     Static module worker and lazy codec bundles
test/
  unit/                      Edit stack, registry, and tool apply tests
  golden/                    Golden-file assertions
  fixtures/                  Known and redistributable reference files
  e2e/                       Playwright smoke, workflow, privacy, and performance tests
  screenshots/               Mobile and desktop screenshot baselines
.github/workflows/test.yml    Test suite on every push and pull request
```

Use the Next.js App Router and TypeScript with `output: 'export'`. Cloudflare Pages builds with `npm run build` and serves `out/`. Routes generate static HTML. The interactive workspace runs in a Client Component. Use Tailwind CSS for layouts optimized equally for phones and laptops, large touch targets, and dark mode. Give every device the same tools, options, and output quality. Give phones touch-friendly controls, gestures, and save-to-device downloads. Use the extra space on laptops for larger previews and side panels, and support drag-and-drop and keyboard shortcuts. Address tight phone memory with WASM paths, tiling, or sequential processing while preserving output quality.

## Phase 1 workspace

- The home page links the Images card to the workspace and marks PDF, Audio, and Video as **Coming soon**.
- The shared workspace owns intake, selection, a large preview, tool controls, undo and redo, export, and job status. It accepts multiple files through drag and drop, the file picker, or paste. Validate and report errors per file so valid files from the same intake remain usable.
- Accept JPG, PNG, WebP, AVIF, GIF, and HEIC. Use the first frame of animated input and decode HEIC with `libheif-js`. Read EXIF orientation on decode and apply it once to the preview or export geometry.
- The Crop plugin provides a movable and resizable crop box with Pointer Events for mouse and touch. It offers free crop and 1:1, 4:5, 16:9, and 9:16 presets. Arrow keys move the focused box or resize the focused corner. In Crop, R and Shift+R rotate by 90°, H flips horizontally, and V flips vertically. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo applied edits.
- Export a single file or a ZIP of multiple results. Offer JPG, PNG, WebP, and AVIF. Use a quality slider where the format supports lossy encoding. Preserve transparency in formats that support it and make the JPG background behavior explicit when the input has alpha. Strip EXIF by default and state that in the export UI.
- Maintain per-file processing progress and actionable errors for unsupported, corrupt, canceled, or failed operations. Announce status changes to assistive technology and preserve focus around editing and export controls.

## Tool contract and registry

Each plugin supplies its UI, option defaults and validation, and implementation. The options panel edits draft options. Confirming a tool records a validated command in the file's history. The worker runs `apply` when it replays that history.

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

The category registry lists tools in toolbar order, looks them up by stable ID, and rejects duplicate IDs or a category mismatch. The image registry registers Convert and Crop. Add a tool by creating its plugin module and registering it. Open the options panel using the registry entry and resolve commands through the same registry in the worker. Keep plugin modules safe to import in the worker and load dependencies that need the DOM inside the UI path. Pass commands as plain structured-cloneable data.

Image plugins replay geometry and export settings. Crop composes source bounds and orientation. Convert updates the output format and quality. The pipeline materializes the final geometry from one raster after replay. The final export encodes once after replaying all edits, so undo, redo, and repeated export avoid cumulative quality loss.

## Edit history and rendering

```ts
interface EditStack {
  readonly original: File;
  readonly commands: readonly EditCommand[];
  readonly cursor: number;
}
```

Store an immutable original and a separate command history per file. Render the active prefix `commands.slice(0, cursor)`. Undo and redo move the cursor within the history bounds. Applying a new command after undo truncates the redo branch. Store crop bounds as normalized coordinates in the oriented frame at that point in the history. The worker rounds crop edges in full-resolution coordinates, composes the edit history, and projects the result onto the preview base. The preview displays the full-resolution output dimensions.

Cache the selected file’s orientation-normalized frame and an area-averaged preview base with a maximum edge of 2,048 px (at most 4,194,304 canvas pixels). Preview commands render from the base, and edits that leave the image and JPG background unchanged reuse the encoded preview. Encode large JPG previews at 95% quality when OffscreenCanvas is available. Evict the cache on selection change. Before validating another file or exporting, release the cached full-size raster and keep the selected preview base. Export decodes the original again and materializes the final edits at full resolution. Copy no source EXIF into the output. Use the relevant `@jsquash` WASM decoders and encoders on raw ImageData in the worker. Reserve canvas and OffscreenCanvas for previews. To stay below the iOS Safari canvas limit of approximately 16.7 MP, never send full-resolution images above 16,000,000 pixels through canvas. Use `fflate` for ZIP generation and feed finished files to the archive one at a time.

## Worker setup and privacy

```ts
interface ImageWorkerApi {
  retainPreview(id: string): void;
  renderPreview(request: PreviewRequest, onProgress: ProgressCallback): Promise<PreviewResult>;
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

Bundle scripts, fonts if needed, worker modules, and WASM as same-origin static assets. Load each WASM codec on first use from same-origin static assets. Allow same-origin GET requests for bundled JS and WASM. Reject any request to an external domain, any request with a body, and any request whose URL contains file names or file data. Keep all file data, names, metadata, previews, and results in the browser. Generate downloads from local blobs. The app has zero uploads, API routes, accounts, or tracking.

## Testing plan

Run `npm ci`, `npx playwright install --with-deps chromium firefox webkit`, and `npm run test:all`. The last command runs Vitest, builds the static export, then serves `out/` locally for Playwright. CI runs the same command on every push and pull request.

| Suite | Phase 1 coverage |
| --- | --- |
| Vitest unit | Edit stack boundaries, redo branch truncation, per-file isolation, registry lookup and validation, and each plugin's `apply()`, including error cases. |
| Golden files | Use reference JPG, PNG, WebP, HEIC, AVIF, and animated GIF inputs plus a 6000 × 4000 image and a transparent PNG in `test/fixtures`. Verify output signatures and MIME types, decodability, dimensions, alpha handling, GIF first frame, EXIF orientation and stripping, and exported ZIP contents. Compare decoded pixels with a tolerance for lossy formats. Load codec WASM from disk in Vitest and exercise browser-specific decode and worker paths in Playwright with the same fixtures. |
| Playwright | Chromium, Firefox, and WebKit on desktop, with iPhone WebKit and Android Chromium touch emulation. Exercise picker, drop, paste, multiple files, conversion, crop presets, pointer resizing, rotation, flips, progress, errors, and single and ZIP download. Cover keyboard editing and history on desktop and touch controls on mobile. |
| Privacy | Start network observation before page initialization. Block service workers. Fail on any request to an external domain, any request with a body, or any request whose URL contains fixture filenames or file data. Allow same-origin GET requests for bundled JS and WASM. Check downloaded files still succeed. |
| Screenshots | Capture each screen and its key states at mobile and desktop sizes in `test/screenshots`, using stable fixtures and Playwright screenshot assertions. |
| Performance | Run a 6000 × 4000 image through preview and export on desktop and mobile emulation. Assert a responsive workspace, job completion, and full output dimensions after a format-only edit. Log the first preview, repeated conversion previews, rotated preview, and export timing per project. Enforce the 300 ms repeat-preview target on desktop Chromium and log its export memory high-water marks. |
