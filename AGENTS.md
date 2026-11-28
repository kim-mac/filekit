# Repository rules

Follow these rules for every task in this repository.

1. Run all file processing in the browser. Keep the Next.js App Router build a static export for Cloudflare Pages. Use Web Workers through Comlink for heavy processing.
2. File uploads are prohibited. Keep originals, previews, extracted metadata, edits, and outputs on the user's device. The app has no API routes, accounts, or tracking. Lazy-load each WASM codec on first use from same-origin static assets. Allow same-origin GET requests for bundled JS, WASM, and verified static model assets. Reject requests to external domains, requests with a body, and requests whose URLs contain file names or file data.
3. Prioritize desktop and laptop for the best output quality, largest models, and richest editing experience. Keep mobile reliable with touch-friendly controls, accessible progress and errors, light and dark modes, and save-to-device downloads. Mobile may use lighter models, smaller inference inputs, or a simplified UI. Choose the highest-quality model each device can run, show the active quality mode, and degrade gracefully on constrained devices.
4. Export from the original full-resolution source and replay the non-destructive edits. Use WASM codecs on raw ImageData in the worker for full-resolution processing. Reserve canvas and OffscreenCanvas for previews. For iOS Safari, cap preview canvases at 16,000,000 pixels to stay clear of its approximately 16.7 MP limit. Preserve the dimensions produced by the user's edits on desktop. Document and display any mobile export cap. Strip EXIF by default.
5. Implement tools as plugins that satisfy the shared tool interface and register them in their category registry. Keep category and tool behavior out of the reusable workspace shell.
6. Write or update tests for the task and run `npm run test:all` locally. A task is only done when the PR's GitHub Actions checks are green. After pushing, wait for CI, read failing logs, fix, and repeat. Never report a task complete with failing or pending CI. Show the command's actual test output in the handoff.

7. Follow the [UI guidelines](docs/ui-guidelines.md) for layout, controls, accessibility, and notices.
