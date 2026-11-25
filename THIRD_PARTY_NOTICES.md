# Third-party notices

FileKit's image background removal bundles the bg0 browser library, Transformers.js, and ONNX Runtime Web. FileKit distributes model assets separately as verified same-origin chunks.

| Component | License and attribution |
| --- | --- |
| [@bg0/browser 0.1.2](https://github.com/opencoredev/bg0/tree/a7a3e2b6dae9739a31c3560500c6b777fc25211f/packages/browser) | Apache-2.0, OpenCore and bg0 contributors. The vendored build is adapted for an OffscreenCanvas worker, same-origin verified chunks and FileKit's tier policy. [License](licenses/bg0/bg0-Apache-2.0.txt) |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | MIT, Copyright (c) 2024 ZhengPeng. Bilateral Reference for High-Resolution Dichotomous Image Segmentation, Peng Zheng et al., CAAI AIR 2024. [License](licenses/bg0/BiRefNet-MIT.txt) |
| [Full BiRefNet 512](https://huggingface.co/naddy24/birefnet-512-webgpu/tree/ca02a86c094927479e2be583abe87f8ea73fcfda) | MIT. Browser export by naddy24, derived from the [ONNX Community export](https://huggingface.co/onnx-community/BiRefNet_512x512-ONNX) and [ZhengPeng7's checkpoint](https://huggingface.co/ZhengPeng7/BiRefNet_512x512). |
| [Lite BiRefNet 512](https://huggingface.co/studioludens/birefnet-lite-512/tree/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7) | MIT. Browser export by studioludens from [ZhengPeng7/BiRefNet_lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite). |
| [iOS Lite model](https://github.com/opencoredev/bg0/blob/a7a3e2b6dae9739a31c3560500c6b777fc25211f/docs/ios-model.md) | MIT. Quantized BiRefNet-lite derived from ZhengPeng7's checkpoint. The bg0 developers adapted the per-tap GridSample export by CoderViking. The [upstream manifest](https://github.com/opencoredev/bg0/blob/a7a3e2b6dae9739a31c3560500c6b777fc25211f/packages/browser/vendor/ios/manifest.json) records the exact weights and runtime. |
| [Transformers.js 4.3.0](https://github.com/huggingface/transformers.js) | Apache-2.0, Hugging Face and contributors. FileKit carries bg0's Web build patch to allow a fallback after failed session creation or inference. [License](licenses/bg0/Transformers-Apache-2.0.txt) |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | MIT, Microsoft Corporation. [License](licenses/bg0/ONNX-Runtime-MIT.txt), [third-party notices](licenses/bg0/ONNX-Runtime-ThirdPartyNotices.txt) |

FileKit passes PNG to bg0 after normalizing the source with FileKit's existing codecs. bg0's separate HEIC decoder is outside the vendored distribution. The development-only benchmark has its own [fixture attributions](test/fixtures/bg/SOURCES.md) and [checkpoint provenance](docs/bg-removal-eval.md).

## Face detection

| Component | License and attribution |
| --- | --- |
| [YuNet ONNX weights](https://github.com/ShiqiYu/libfacedetection.train/blob/a61a428929148171b488f024b5d6774f93cdbc13/tasks/task1/onnx/yunet.onnx) | MIT, Shiqi Yu and upstream contributors. [Original license](https://github.com/ShiqiYu/libfacedetection.train/blob/a61a428929148171b488f024b5d6774f93cdbc13/LICENSE), [distributed copy](public/face-models/YuNet-MIT.txt). |

FileKit distributes the 344,799-byte checkpoint without changes. The worker verifies SHA-256 `be449cd884ae1bc17e089b78e132e80df959b88452f32c487c6fb0a8c8e27f14` and runs inference using the bundled ONNX Runtime Web WASM runtime. FileKit’s anchor decoding follows the author’s [model configuration](https://github.com/ShiqiYu/libfacedetection.train/blob/a61a428929148171b488f024b5d6774f93cdbc13/tasks/task1/config.py) and [detector](https://github.com/ShiqiYu/libfacedetection.train/blob/a61a428929148171b488f024b5d6774f93cdbc13/tasks/task1/detect.py). The face detection test uses [Didi Medina’s CC0 portrait](test/fixtures/bg/SOURCES.md).
