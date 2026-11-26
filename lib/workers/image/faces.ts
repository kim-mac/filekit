import { wasmThreads } from '../wasm-threads.mjs';
import { InferenceSession, Tensor, env } from 'onnxruntime-web/wasm';
import type { Bounds } from '../../tools/image/geometry';
import { resizePreview } from './pixels';
import { yuNetSha256 } from './face-model';

const modelUrl = '/face-models/yunet.onnx';
const runtimeName = 'ort-wasm-simd-threaded';
const anchors = [[10, 16, 24], [32, 48], [64, 96], [128, 192, 256]];

let detector: Promise<InferenceSession> | undefined;

function loadDetector(mobile: boolean) {
  detector ??= (async () => {
    const response = await fetch(modelUrl, { redirect: 'error' });
    if (!response.ok) throw new Error('Could not load the local face detector.');
    const weights = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', weights);
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== yuNetSha256) throw new Error('Could not verify the local face detector.');

    const runtime = new URL('/bg-runtime/onnx/', location.origin).href;
    env.wasm.wasmPaths = { mjs: `${runtime}${runtimeName}.mjs`, wasm: `${runtime}${runtimeName}.wasm` };
    env.wasm.numThreads = wasmThreads(mobile);
    env.wasm.proxy = false;
    return InferenceSession.create(weights, { executionProviders: ['wasm'] });
  })().catch(error => {
    detector = undefined;
    throw error;
  });
  return detector;
}

function overlap(a: Bounds, b: Bounds) {
  const intersection = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const area = (box: Bounds) => (box.right - box.left) * (box.bottom - box.top);
  return intersection / (area(a) + area(b) - intersection);
}

export async function findYuNetFaces(frame: ImageData, session: InferenceSession): Promise<Bounds[]> {
  const { width, height, data } = resizePreview(frame, 320);
  const paddedWidth = Math.ceil(width / 64) * 64;
  const paddedHeight = Math.ceil(height / 64) * 64;
  const plane = paddedWidth * paddedHeight;
  const input = new Float32Array(plane * 3).fill(127);

  // YuNet expects unnormalized BGR in planar order. Pad to preserve aspect
  // ratio and keep the feature-map strides exact.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * paddedWidth + x;
      const pixel = (y * width + x) * 4;
      const alpha = data[pixel + 3] / 255;
      for (let c = 0; c < 3; c++) input[c * plane + index] = data[pixel + 2 - c] * alpha + 127 * (1 - alpha);
    }
  }

  const tensor = new Tensor('float32', input, [1, 3, paddedHeight, paddedWidth]);
  let result: InferenceSession.ReturnType;
  try {
    result = await session.run({ input: tensor });
  } finally {
    tensor.dispose();
  }
  const loc = result.loc.data as Float32Array;
  const conf = result.conf.data as Float32Array;
  const iou = result.iou.data as Float32Array;
  const candidates: { bounds: Bounds; score: number }[] = [];
  const unit = (value: number) => Math.max(0, Math.min(1, value));
  let index = 0;
  for (const [level, sizes] of anchors.entries()) {
    const stride = 8 << level;
    for (let y = 0; y < paddedHeight / stride; y++) {
      for (let x = 0; x < paddedWidth / stride; x++) {
        for (const size of sizes) {
          const delta = index * 14;
          const score = Math.sqrt(conf[index * 2 + 1] * unit(iou[index]));
          index++;
          if (!(score >= 0.55)) continue;
          const cx = (x + 0.5) * stride + loc[delta] * 0.1 * size;
          const cy = (y + 0.5) * stride + loc[delta + 1] * 0.1 * size;
          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
          // Add space around the predicted face for the blur coverage.
          const halfW = Math.exp(loc[delta + 2] * 0.2) * size * 0.57;
          const halfH = Math.exp(loc[delta + 3] * 0.2) * size * 0.57;
          candidates.push({ score, bounds: {
            left: unit((cx - halfW) / width), top: unit((cy - halfH) / height),
            right: unit((cx + halfW) / width), bottom: unit((cy + halfH) / height),
          } });
        }
      }
    }
  }

  for (const output of Object.values(result)) output.dispose();

  const kept: Bounds[] = [];
  for (const { bounds } of candidates.sort((a, b) => b.score - a.score)) {
    if (kept.every(other => overlap(bounds, other) <= 0.3)) kept.push(bounds);
  }
  return kept;
}

export async function detectFaces(frame: ImageData, mobile: boolean) {
  return findYuNetFaces(frame, await loadDetector(mobile));
}
