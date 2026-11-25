# Background removal model evaluation

## Recommendation

Use the pinned **U²-Net-p FP32** checkpoint with **ONNX Runtime Web in a dedicated Comlink worker**. Use hardware WebGPU after an adapter and session can run the model successfully, with single-threaded WASM as the fallback. Keep WASM active for initial integration until device testing validates WebGPU. Phones and laptops use the same bytes, 320 × 320 input, normalization, and alpha reconstruction. Release the failed GPU session by terminating its worker before starting the WASM worker. Cache the model on first use so a backend switch does not download it again.

U²-Net-p is an Apache-2.0 general-purpose checkpoint that fits in one small Pages asset. Its soft masks work well for centered subjects and simple products. The comparison sheets show important limits on clutter, low-contrast subject boundaries, fine strands, and transparency. Keep alpha refinement disabled by default based on the edge trial below.

This is a development spike. The benchmark runs from a local server at `/dev/bg-bench`. The Next.js static export omits the route, benchmark dependencies, fixtures, and weights.

## Checkpoints

The timed artifacts are FP32. Their exact URLs, byte counts, SHA-256 hashes, tensor names, and preprocessing are in the [model manifest](../scripts/bg-bench/models.json). Alternative sizes are publisher-reported decimal MB and were not benchmarked. Precision and execution-provider compatibility can differ between exports.

| Candidate | Checkpoint license and status | Input | FP32 tested (MiB) | Published FP16 | Published quantized |
| --- | --- | --- | ---: | --- | --- |
| U²-Net-p | Apache-2.0, eligible | 320 × 320 | 4.36 | Unverified | Unverified |
| MODNet Photographic | Apache-2.0, eligible, portrait-specific | Dynamic H × W, longest side 512 with both sides rounded down to multiples of 32 | 24.77 | 13 MB, community | 6.63 MB, community |
| IS-Net General Use | Apache-2.0 code and evaluation metric, checkpoint terms unverified, excluded | 1024 × 1024 | 170.37 | 91.1 MB, third-party FP16 storage with FP32 compute | Unverified |
| BiRefNet General Lite | MIT, eligible | 1024 × 1024 | 213.63 | 115 MB, community | Unverified |
| BRIA RMBG 1.4 | BRIA non-commercial terms, excluded | 1024 × 1024 | 167.99 | 88.2 MB | 44.4 MB |

- U²-Net-p uses the rembg conversion of Xuebin Qin et al.'s lightweight saliency model. The community mirror records the model and weights under Apache-2.0. [Upstream U²-Net](https://github.com/xuebinqin/U-2-Net), [export provenance and license](https://huggingface.co/nfa04/u2netp-onnx).
- MODNet upstream covers the photographic weights under Apache-2.0. The evaluated graph is yakhyo's Photographic export. The smaller community graphs use different export packaging. [Upstream MODNet license statement](https://github.com/ZHKKKe/MODNet#license), [evaluated export](https://github.com/yakhyo/modnet#pre-trained-models), [community variants](https://huggingface.co/onnx-community/modnet-webnn/tree/main/onnx).
- IS-Net upstream grants Apache-2.0 for its code and evaluation metric. The original general-use weight redistribution question remains open. A third party also publishes a 91.1 MB FP16-storage graph. [Upstream DIS license statement](https://github.com/xuebinqin/DIS#license), [checkpoint redistribution question](https://github.com/xuebinqin/DIS/issues/150), [third-party FP16 storage](https://github.com/aruiki/stemstudio-isnet-onnx).
- BiRefNet's author publishes the lightweight weights as MIT and discusses commercial redistribution of exported weights. The community FP16 file is a distinct export. [Author's checkpoint](https://huggingface.co/ZhengPeng7/BiRefNet_lite), [author license discussion](https://huggingface.co/ZhengPeng7/BiRefNet/discussions/23), [community ONNX variants](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/tree/main/onnx).
- BRIA publishes RMBG 1.4 as source-available for non-commercial use. The spike records observed output quality for comparison. [BRIA model and terms](https://huggingface.co/briaai/RMBG-1.4), [BRIA ONNX variants](https://huggingface.co/briaai/RMBG-1.4/tree/main/onnx).

## Method

- A fresh Chromium process and worker handle each model and backend. Cold load covers the runtime import, serial same-origin weight reads, SHA-256 verification, weight assembly, and execution-provider session creation. It uses a loopback server with HTTP caching disabled. The result JSON splits weight fetch/verification from runtime session creation. First-visit download time on a phone will also depend on its network.
- Inference timing starts at `session.run` and ends when the selected output tensor is readable by the CPU. Decode, input scaling, mask scaling, scoring, post-processing, and PNG encoding are outside inference time. The runner saves each measured sample, including cold first inference. It supports repeated runs on each fixture.
- Peak memory is the sampled sum of Linux proportional-set size (PSS) for the browser process tree, including the renderer hosting the worker and the GPU process. The sampler runs every 250 ms from just before load to just before browser shutdown. Reported deltas subtract the idle page baseline. This is process memory, including native and WASM allocations. Short peaks between samples and dedicated GPU VRAM are outside the measurement.
- The 15 fixtures include 11 licensed photos and four synthetic composites with known alpha. IoU and boundary F-score use grayscale alpha ≥ 128 and a 2 px Euclidean matching radius at fixture resolution, with equal weight per scored image in the macro average. The two bottle fixtures share a silhouette. Binary metrics describe foreground overlap, so they give limited information about soft fur or partially transparent glass. The unscored photographs are reviewed using the original, grayscale mask, and checkerboard cutout. [Fixture licenses and provenance](../test/fixtures/bg/SOURCES.md).
- Playwright forces one execution provider per run. A failed WebGPU run is recorded as a failure. The interactive Auto mode can retry using WASM. ONNX Runtime may place unsupported WebGPU operators on the CPU inside a WebGPU session. Benchmarks are from a Linux AMD EPYC 9V74 VM with a two-vCPU quota, Chromium 156 and ONNX Runtime Web 1.25.1. Software WebGPU runs use Chromium SwiftShader and the WebGPU provider requests NHWC layout. Phone and laptop hardware measurements are still needed to establish latency and memory budgets.

## Results

See the [comparison sheets and raw measurements](bg-eval/README.md).

### WASM

| Model | Masks | Cold load (s) | Inference median / p95 (s) | Peak / delta (MiB) | IoU / boundary F |
| --- | ---: | ---: | ---: | ---: | ---: |
| U²-Net-p | 15 / 15 | 4.16 | 7.99 / 14.19 | 664 / 478 | 0.772 / 0.774 |
| MODNet Photographic | 15 / 15 | 2.71 | 2.44 / 6.13 | 535 / 275 | 0.466 / 0.521 |
| IS-Net General Use | 15 / 15 | 4.26 | 13.08 / 13.98 | 1256 / 993 | 0.841 / 0.907 |
| BiRefNet General Lite | 0 / 15 | 11.92 | — | 4525 / 4263 | — |
| BRIA RMBG 1.4 | 15 / 15 | 7.43 | 24.20 / 44.39 | 1110 / 904 | 0.857 / 0.867 |

One inference was timed per fixture in the matrix. The shared VM also ran browser tests and software WebGPU cases during portions of the matrix, so these latency figures include contention. A separate sequential run of the two finalists timed two passes each over `portrait-wind`, `product-low-contrast`, and `fuzzy-toy`. Its median inference times were **1.59 s for U²-Net-p** and **1.29 s for MODNet**, with cold load of 0.82 and 1.00 s and peak PSS of 595 and 531 MiB, respectively. Both runs used the Cloud VM.

- **U²-Net-p** retained both bottle silhouettes (IoU 0.995 and 0.990) and cut out the white-background vase cleanly. It included part of the wall behind the urban subject and weakened the tabby's flank and tail. Its glass mask treated much of the transparent bowl as opaque.
- **MODNet** gave the two portraits more detailed hair and isolated the urban person without retaining the wall. It dropped most of the low-contrast bottle and produced holes in the bottle on white. Its narrower coverage makes it unsuitable as the general model.
- **IS-Net** retained the backpack strap and well-defined toy strands. It left a visible haze around the dark-haired portrait, made parts of the chow translucent, and retained background stripes through the glass. It reached 0.400 glass IoU on the synthetic reference.
- **BRIA RMBG** retained more of the tabby's body and tail and separated the urban person from the wall. It kept some vegetation around the tabby's tail and treated the sunglass lenses as mostly opaque. Its synthetic glass IoU was 0.457. Its checkpoint is excluded by license.
- **BiRefNet Lite** loaded and then returned `std::bad_alloc` on all 15 WASM inference attempts. The browser process tree crossed 4 GiB sampled PSS. The WASM fallback failed on the benchmark host.

### WebGPU on SwiftShader

| Model | Cold load (s) | Completed masks | Inference median (s) or failure | Peak / delta (MiB) |
| --- | ---: | ---: | --- | ---: |
| U²-Net-p | 4.29 | 0 / 15 | 90 s first-case timeout | 899 / 671 |
| MODNet Photographic | 4.96 | 0 / 15 | 90 s first-case timeout | 878 / 634 |
| IS-Net General Use | 14.59 | 0 / 15 | 90 s first-case timeout | 1628 / 1376 |
| BiRefNet General Lite | 79.02 | 0 / 15 | Shader needed 11 storage buffers (adapter limit 10). Second case timed out. | 2318 / 2058 |
| BRIA RMBG 1.4 | 12.28 | 0 / 15 | 90 s first-case timeout | 2326 / 2111 |

The host exposes only a software WebGPU adapter. The first-case deadline includes inference and result delivery. The runner moves to the next checkpoint after that deadline. BiRefNet also hit a shader storage-buffer limit before its second case timed out. The timeout rows report the observed case deadline, cold session load, and sampled memory. Hardware WebGPU inference, provider-to-provider output parity, and physical phone budgets remain unverified. The interactive smoke used a phone-sized viewport and confirmed that Auto skipped the software adapter, selected WASM, produced a cutout, and used only same-origin GET requests.

## Edge refinement

The guided filter uses original-image luminance with a 4 px radius and an epsilon of 0.001. The color pass estimates background RGB from low-alpha neighbors in a 12 px radius, blends a bounded correction into partially opaque pixels, and leaves alpha unchanged. Review each original mask, guided mask, and guided mask with color cleaning in the [edge sheets](bg-eval/README.md#edge-refinement).

The trial used seven hair/fur fixtures for each model. U²-Net-p and MODNet were the two permissively licensed candidates that produced WASM masks. IS-Net was added as a quality reference. The fuzzy toy is the one fixture with a reference alpha in this subset.

| Checkpoint | Fuzzy toy IoU, baseline → guided | Fuzzy toy boundary F, baseline → guided |
| --- | ---: | ---: |
| U²-Net-p | 0.942 → 0.944 | 0.680 → 0.598 |
| MODNet Photographic | 0.962 → 0.947 | 0.851 → 0.639 |
| IS-Net General Use | 0.971 → 0.957 | 0.938 → 0.748 |

Guided alpha softened the contour on real portraits and brushed down thin strands on the toy. The small U²-Net-p IoU gain came with an 8-point boundary F drop. It also left larger segmentation mistakes visible, such as the translucent flank on the tabby. Color decontamination subtly reduced fringe tint on parts of the windswept portrait, while the green background retained above the dark-haired portrait remained visible. The color pass adjusts RGB with the same alpha. Its quality assessment is visual. These results favor the original model alpha for the initial implementation.

## Same-origin delivery on Cloudflare Pages

Use immutable versioned URLs with a content digest. Stage the selected worker, ORT assets, weight manifest, and weights during release packaging. The dedicated worker verifies byte lengths and hashes before using local bytes. Read from Cache Storage after the first successful download. Use versioned cache keys and validate cache hits. If quota or private browsing prevents storing weights, use the validated bytes for the current session and let the next session retry. Warm the worker before handing over image pixels. All runtime asset requests are same-origin GETs, and image names, image bytes, and outputs stay on the device. [Cloudflare Pages 25 MiB asset limit](https://developers.cloudflare.com/pages/platform/limits/#file-size).

| Permissively licensed candidate | Same-origin FP32 plan |
| --- | --- |
| **U²-Net-p** | One 4,574,861-byte immutable file and a small versioned manifest. Cache the file after verification. |
| MODNet Photographic | One 25,969,398-byte file fits below 26,214,400 bytes. The dev packer conservatively splits this into two files with its uniform 24 MiB chunk cap. |
| BiRefNet General Lite | Nine ordered files at ≤ 24 MiB each. Cache verified chunks and read them sequentially into one allocated buffer in the worker. Chunking solves the asset cap. Browser session memory and the full first-use transfer remain high. |

Package the exact WebGPU and WASM artifacts for the installed ORT version. The benchmark uses ORT's WebGPU Asyncify binary (23,427,852 bytes) and standard WASM binary (12,810,620 bytes). Each fits below the Pages limit. Cache executable assets and weights separately so version changes are explicit. Publish the upstream license and attribution alongside the selected checkpoint. The Android and iOS acceptance run should include cold and warm loads, simulated WebGPU initialization loss, and alpha comparison between providers with the same model digest.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run bg:prepare
npm run bg:dev
```

Open `http://127.0.0.1:4310/dev/bg-bench`. Select WebGPU, WASM, or Auto to browse fixture outputs. In a separate terminal run the Playwright matrix.

```sh
npm run bg:bench -- --refine u2netp,modnet
```

The runner starts its own loopback server, so the interactive server is optional. It writes JSON, full fixture-sized mask PNGs, per-image rows, and comparison/refinement sheets under `.cache/bg-bench/results/`. `--models`, `--backends`, and `--fixtures` accept comma-separated IDs. Use `--repeats 1` for a shorter run, `--software-webgpu` to force SwiftShader for diagnostics, and `BG_CHROMIUM=/path/to/chromium` to select a local browser. A nonzero exit marks a failed model or fixture, and successful artifacts and error details remain available.

`npm run bg:prepare` downloads checkpoints to a gitignored staging directory, verifies their pinned hashes, and stages local manifests and files. With `BG_MODEL_DOWNLOADS=/path/to/onnx-files`, it instead verifies a local copy of each upstream release filename. The dev page and worker only access staged assets and fixtures on loopback.
