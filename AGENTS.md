# Repository rules

Follow these rules for every task in this repository.

1. Run all file processing in the browser. Keep the Next.js App Router build a static export for Cloudflare Pages. Use Web Workers through Comlink for heavy processing.
2. File uploads are prohibited. Keep originals, previews, extracted metadata, edits, and outputs on the user's device. The app has no API routes, accounts, or tracking. Lazy-load each WASM codec on first use from same-origin static assets. Allow same-origin GET requests for bundled JS and WASM. Reject requests to external domains, requests with a body, and requests whose URLs contain file names or file data.
3. Optimize equally for phones and laptops. Provide the same tools, options, and output quality across devices. On phones, offer touch-friendly controls, large tap targets, gestures, and save-to-device downloads. On laptops, use the extra space for larger previews and side panels, and support drag-and-drop and keyboard shortcuts. Keep controls, progress, and errors accessible, and support light and dark modes. Address tight memory with WASM paths, tiling, or sequential processing while preserving output quality.
4. Export from the original full-resolution source and replay the non-destructive edits. Use WASM codecs on raw ImageData in the worker for full-resolution processing. Reserve canvas and OffscreenCanvas for previews. For iOS Safari, cap preview canvases at 16,000,000 pixels to stay clear of its approximately 16.7 MP limit. Preserve the dimensions produced by the user's edits and strip EXIF by default.
5. Implement tools as plugins that satisfy the shared tool interface and register them in their category registry. Keep category and tool behavior out of the reusable workspace shell.
6. Write or update tests for the task and run `npm run test:all` before marking it done. A task is only done when that command passes. Fix failures and rerun the suite. Show the command's actual test output in the handoff.
