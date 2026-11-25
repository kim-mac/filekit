# FileKit architecture

FileKit is a privacy-first browser application for image, PDF, audio, and video tools. Phase 1 ships the image workspace. Phase 1a covers intake, conversion, and export. Crop, rotate, and flip follow in Phase 1b.

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
    image/                   Browser decoding, render, encoding, and ZIP functions
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
- Accept JPG, PNG, WebP, AVIF, GIF, and HEIC. Use the first frame of animated input and decode HEIC with `libheif-js`. Normalize EXIF orientation once on decode.
- In Phase 1b, use `react-easy-crop` for touch-friendly free crop and the 1:1, 4:5, 16:9, and 9:16 presets. Provide 90° rotation and flipping with touch and keyboard controls. Give the crop bounds equivalent keyboard controls.
- Export a single file or a ZIP of multiple results. Offer JPG, PNG, WebP, and AVIF. Use a quality slider where the format supports lossy encoding. Preserve transparency in formats that support it and make the JPG background behavior explicit when the input has alpha. Strip EXIF by default and state that in the export UI.
- Maintain per-file processing progress and actionable errors for unsupported, corrupt, canceled, or failed operations. Announce status changes to assistive technology and preserve focus around editing and export controls.

## Tool contract and registry

Each plugin supplies its UI, option defaults and validation, and implementation. The options panel edits draft options. Confirming a tool records a validated command in the file's history. The worker runs `apply` when it replays that history.

```ts
type Category = 'image' | 'pdf' | 'audio' | 'video';

interface ToolDefinition<Input, Options, Output> {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly icon: ComponentType;
  readonly OptionsPanel: ComponentType<{
    value: Options;
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

The category registry lists tools in toolbar order, looks them up by stable ID, and rejects duplicate IDs or a category mismatch. The image registry registers Convert in Phase 1a and adds Crop in Phase 1b. Add a tool by creating its plugin module and registering it. Open the options panel using the registry entry and resolve commands through the same registry in the worker. Keep plugin modules safe to import in the worker and load dependencies that need the DOM inside the UI path. Only plain structured-cloneable command data crosses the worker boundary.

Use an image state with the current frame, geometry, and export settings as the input and output of image plugins. Crop changes geometry. Convert updates the output format and quality. The final export encodes once after replaying all edits, so undo, redo, and repeated export avoid cumulative quality loss.

## Edit history and rendering

```ts
interface EditStack {
  readonly original: File;
  readonly commands: readonly EditCommand[];
  readonly cursor: number;
}
```

Store an immutable original and a separate command history per file. Render the active prefix `commands.slice(0, cursor)`. Undo and redo move the cursor within the history bounds. Applying a new command after undo truncates the redo branch. Store crop bounds as normalized coordinates in the oriented frame at that point in the history. Apply the same geometry and pixel rounding rules in preview and export so results agree.

Generate previews at a bounded resolution suited to the display and retain only a small set of thumbnails and previews. Export by decoding the original and replaying the active commands at full resolution, with the final pixel dimensions determined by the requested transforms. Copy no source EXIF into the output. Use the relevant `@jsquash` WASM decoders and encoders on raw ImageData in the worker. Reserve canvas and OffscreenCanvas for previews. To stay below the iOS Safari canvas limit of approximately 16.7 MP, never send full-resolution images above 16,000,000 pixels through canvas. Use `fflate` for ZIP generation and feed finished files to the archive one at a time.

## Worker setup and privacy

```ts
interface ImageWorkerApi {
  renderPreview(request: PreviewRequest, onProgress: ProgressCallback): Promise<PreviewResult>;
  exportImage(request: ExportRequest, onProgress: ProgressCallback): Promise<Blob>;
  exportZip(request: ZipRequest, onProgress: ProgressCallback): Promise<ZipResult>;
  // The client cancels by terminating the worker and settling the active job.
}
```

Instantiate a module worker from the workspace using `new Worker(new URL(..., import.meta.url), { type: 'module' })`. Use Comlink `wrap` in the client, `expose` in the worker, and `proxy` for progress callbacks. Requests include job IDs, original file references, command snapshots, and the preview bounds or export settings. Pass File or Blob references through structured clone and transfer ArrayBuffers when ownership can move. Return preview or output blobs without sending decoded full-size pixel buffers to the UI.

Serialize full-resolution work and process batch files one at a time. Prioritize the active preview and discard results from superseded edits. The client cancels active WASM calls by terminating the worker and supersedes previews when the selection changes. Use job IDs to ignore late responses. Release bitmaps, temporary pixel buffers, callbacks, and object URLs when the job or UI no longer needs them. Assess peak memory at the 6000 × 4000 fixture size, where a single RGBA buffer is about 92 MiB. Cap preview memory and avoid holding multiple decoded originals or creating extra full-size copies.

Bundle scripts, fonts if needed, worker modules, and WASM as same-origin static assets. Load each WASM codec on first use from same-origin static assets. Allow same-origin GET requests for bundled JS and WASM. Reject any request to an external domain, any request with a body, and any request whose URL contains file names or file data. Keep all file data, names, metadata, previews, and results in the browser. Generate downloads from local blobs. The app has zero uploads, API routes, accounts, or tracking.

## Testing plan

Run `npm ci`, `npx playwright install --with-deps chromium firefox webkit`, and `npm run test:all`. The last command runs Vitest, builds the static export, then serves `out/` locally for Playwright. CI runs the same command on every push and pull request.

| Suite | Phase 1 coverage |
| --- | --- |
| Vitest unit | Edit stack boundaries, redo branch truncation, per-file isolation, registry lookup and validation, and each plugin's `apply()`, including error cases. |
| Golden files | Use reference JPG, PNG, WebP, HEIC, AVIF, and animated GIF inputs plus a 6000 × 4000 image and a transparent PNG in `test/fixtures`. Verify output signatures and MIME types, decodability, dimensions, alpha handling, GIF first frame, EXIF orientation and stripping, and exported ZIP contents. Compare decoded pixels with a tolerance for lossy formats. Load codec WASM from disk in Vitest and exercise browser-specific decode and worker paths in Playwright with the same fixtures. |
| Playwright | Chromium, Firefox, and WebKit on desktop, with iPhone WebKit and Android Chromium touch emulation. Exercise intake by picker, drop, and paste, multiple files, conversion, undo and redo, progress and errors, and single and ZIP download. Cover crop and presets, rotation, and flip in Phase 1b. |
| Privacy | Start network observation before page initialization. Block service workers. Fail on any request to an external domain, any request with a body, or any request whose URL contains fixture filenames or file data. Allow same-origin GET requests for bundled JS and WASM. Check downloaded files still succeed. |
| Screenshots | Capture each screen and its key states at mobile and desktop sizes in `test/screenshots`, using stable fixtures and Playwright screenshot assertions. |
| Performance | Run a 6000 × 4000 image through preview and export on desktop and mobile emulation. Assert a responsive workspace, job completion, and full output dimensions after a format-only edit. Log preview and export times with the project and format. |
