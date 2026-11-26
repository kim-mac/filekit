# Upscale evaluation

The sheets compare the original Real-ESRGAN weights in dynamic FP32 ONNX at native 4× against Pillow bicubic. Each column uses the same decoded RGB input. The boxes mark crops shown at 100% of the output resolution. The six-image comparison is visual and uses no high-resolution ground truth. [Inputs](upscale-eval/inputs) · [CPU timings](upscale-eval/model-timings.json)

| Model | ONNX bytes | Observed behavior |
| --- | ---: | --- |
| [Real-ESRGAN x4plus](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth) | 66,905,712 (63.81 MiB) | Most texture on cloth and the vase. Added plausible facial detail in the archival JPEG that the input cannot establish. Took 12–16× as long as General in these CPU runs. |
| [realesr-general-x4v3](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth) | 4,861,368 (4.64 MiB) | Best practical Photo default. Sharpens fabric and outlines with smoother fine textures and a much smaller download. |
| [realesr-animevideov3](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth) | 2,490,150 (2.37 MiB) | Clean strokes and flat fills on the screenshot and illustration. Smooths textures and can stylize faces. |

All three checkpoints are published by Xintao Wang's Real-ESRGAN project under its BSD-3-Clause license. The exporter checks the SHA-256 of each original checkpoint. FileKit distributes the two compact ONNX exports. [Authors’ pinned license](https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/LICENSE) · [Authors’ model zoo](https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/docs/model_zoo.md) · [ONNX exporter](../scripts/upscale-eval/export.py)

| Device | Recommendation |
| --- | --- |
| Desktop WebGPU | General for Photo and Anime for Art/Text. WebGPU on a hardware adapter uses larger tiles to reduce duplicated work. |
| Desktop WASM | Same models for consistent output. Crop first to reduce inference time on large sources. |
| Mobile | Anime for art or text and General for photos. Both use smaller WASM tiles. Start at 2× when practical. |

The app limits Upscale output to 64 MP and 16,380 px per side on desktop, and 16 MP and 8,192 px per side on mobile. The model sizes exclude the shared ONNX Runtime, downloaded on demand (13.60 MiB binary for WASM or 25.62 MiB in chunks for WebGPU). The WebGPU smoke used Chromium’s SwiftShader adapter. The 1,000 × 1,000 timing measures the desktop WASM path. [Browser timings](upscale-eval/browser-timing.json)

## Comparison sheets and image terms

| Sheet | Source and redistribution terms |
| --- | --- |
| [Person](upscale-eval/person.webp) | Didi Medina, *Woman posing by drainpipe*. Cropped and reduced from FileKit's `person-urban.jpg`. [Original, CC0 1.0](https://commons.wikimedia.org/wiki/File:Woman_posing_by_drainpipe_(Unsplash).jpg) · [Fixture provenance](../test/fixtures/bg/SOURCES.md) |
| [Landscape](upscale-eval/landscape.webp) | SpaceX, DSCOVR launch at Cape Canaveral. Reduced from scikit-image's `rocket.jpg`. [Original photograph](https://www.flickr.com/photos/spacexphotos/16511594820/in/photostream/) · [Public-domain source note](https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/_fetchers.py#L1032-L1052) |
| [Product](upscale-eval/product.webp) | Oriento, red vase on white. Reduced from FileKit's `vase-white.jpg`. [Original photo](https://unsplash.com/photos/lh7ZFoTtfi0) · [Unsplash License](https://unsplash.com/license) |
| [Text and screenshot](upscale-eval/text.webp) | Generated mock export form with small type. Original FileKit fixture dedicated to the public domain. [Generator](../scripts/upscale-eval/compare.py) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Archival JPEG](upscale-eval/archival-jpeg.webp) | NASA, Eileen Collins portrait. Simulated a degraded low-resolution copy by cropping the archive image and encoding it at JPEG quality 14. [Original photograph](https://flic.kr/p/r9qvLn) · [Public-domain source note](https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/_fetchers.py#L382-L401) |
| [Illustration](upscale-eval/illustration.webp) | Generated moon and mountains with flat colors and one-pixel star details. Original FileKit fixture dedicated to the public domain. [Generator](../scripts/upscale-eval/compare.py) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

To reproduce, save the linked checkpoints as `plus.pth`, `general.pth`, and `anime.pth` under `/tmp/upscale-checkpoints`. With Python, PyTorch, ONNX, ONNX Runtime, NumPy, and Pillow installed, run the following commands.

```sh
python scripts/upscale-eval/export.py /tmp/upscale-checkpoints /tmp/upscale-onnx
python scripts/upscale-eval/compare.py /tmp/upscale-onnx
```

The desktop timing run is opt-in because Apply processes all 16 MP before making the bounded preview. Run it with
`FILEKIT_UPSCALE_TIMING=1 npm run test:e2e -- --project=desktop-chromium --grep 'times the real Photo model'`.
