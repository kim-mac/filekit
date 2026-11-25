# Background removal benchmark artifacts

[Evaluation and recommendation](../bg-removal-eval.md) · [Fixture sources and licenses](../../test/fixtures/bg/SOURCES.md)

Each row shows the original, the predicted alpha mask, and the cutout over a checkerboard. White in a mask indicates opaque foreground. The sheets are lossless WebP copies of the PNGs produced by the harness.

## WASM comparisons

| Checkpoint | Portraits, urban person, cats | Dogs, vase, teapot, lenses | Backpack, bottles, glass, toy |
| --- | --- | --- | --- |
| U²-Net-p | [Sheet 1](u2netp/comparison-1.webp) | [Sheet 2](u2netp/comparison-2.webp) | [Sheet 3](u2netp/comparison-3.webp) |
| MODNet Photographic | [Sheet 1](modnet/comparison-1.webp) | [Sheet 2](modnet/comparison-2.webp) | [Sheet 3](modnet/comparison-3.webp) |
| IS-Net General Use | [Sheet 1](isnet/comparison-1.webp) | [Sheet 2](isnet/comparison-2.webp) | [Sheet 3](isnet/comparison-3.webp) |
| BRIA RMBG 1.4 | [Sheet 1](bria-rmbg/comparison-1.webp) | [Sheet 2](bria-rmbg/comparison-2.webp) | [Sheet 3](bria-rmbg/comparison-3.webp) |

BiRefNet General Lite hit an allocation error on every WASM fixture before it produced a mask.

## Edge refinement

Each fixture has three stacked rows for the original prediction, guided alpha, and guided alpha with edge color decontamination.

| Checkpoint | Portraits | Cats | Dogs | Fuzzy toy |
| --- | --- | --- | --- | --- |
| U²-Net-p | [Sheet 1](u2netp/refinement-1.webp) | [Sheet 2](u2netp/refinement-2.webp) | [Sheet 3](u2netp/refinement-3.webp) | [Sheet 4](u2netp/refinement-4.webp) |
| MODNet Photographic | [Sheet 1](modnet/refinement-1.webp) | [Sheet 2](modnet/refinement-2.webp) | [Sheet 3](modnet/refinement-3.webp) | [Sheet 4](modnet/refinement-4.webp) |
| IS-Net General Use, reference | [Sheet 1](isnet/refinement-1.webp) | [Sheet 2](isnet/refinement-2.webp) | [Sheet 3](isnet/refinement-3.webp) | [Sheet 4](isnet/refinement-4.webp) |

## Raw measurements

- [WASM matrix](measurements-wasm.json)
- [SwiftShader WebGPU matrix](measurements-webgpu.json)
- [MODNet refinement trial](measurements-modnet-edge.json)
- [Sequential WASM finalist retest](measurements-finalists.json)

The reproducible runner writes full fixture-sized mask PNGs, including guided alpha where tested, under the corresponding model's `masks/` directory.
