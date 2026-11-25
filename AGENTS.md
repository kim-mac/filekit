# Repository rules

Follow these rules for every task in this repository.

1. Run all file processing in the browser. Keep the Next.js App Router build a static export for Cloudflare Pages. Use Web Workers through Comlink for heavy processing.
2. File uploads are prohibited. Keep originals, previews, extracted metadata, edits, and outputs on the user's device. The app has no API routes, accounts, or tracking. Bundle dependencies and initialize workers and codecs before accepting files so processing makes zero network requests.
3. Design mobile-first. Support touch and keyboard, use large touch targets, and keep controls, progress, and errors accessible on phones and desktops. Support light and dark modes.
4. Export from the original full-resolution source and replay the non-destructive edits. Downsample only previews. Preserve the dimensions produced by the user's edits and strip EXIF by default.
5. Implement tools as plugins that satisfy the shared tool interface and register them in their category registry. Keep category and tool behavior out of the reusable workspace shell.
6. Write or update tests for the task and run `npm run test:all` before marking it done. A task is only done when that command passes. Fix failures and rerun the suite. Show the command's actual test output in the handoff.
