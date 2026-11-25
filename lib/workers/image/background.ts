import type { BackgroundOptions } from '../../tools/image/background-options';
import { flatten, resizePreview } from './pixels';

function distanceSquared(a: number, b: number, width: number) {
  return (a % width - b % width) ** 2 + (Math.floor(a / width) - Math.floor(b / width)) ** 2;
}

// Propagate nearby, confidently transparent pixels over the small matte grid.
// The guide is immutable while full-resolution pixels are changed in place.
function nearestBackground(alpha: Uint8Array, width: number, height: number, guide: Uint8ClampedArray) {
  const nearest = new Int32Array(alpha.length);
  nearest.fill(-1);
  function visit(index: number, adjacent: number) {
    const candidate = nearest[adjacent];
    if (candidate >= 0 && (nearest[index] < 0 ||
      distanceSquared(candidate, index, width) < distanceSquared(nearest[index], index, width))) {
      nearest[index] = candidate;
    }
  }
  for (let index = 0; index < alpha.length; index++) {
    if (alpha[index] <= 16 && guide[4 * index + 3] >= 250) nearest[index] = index;
    else {
      const x = index % width;
      if (x) visit(index, index - 1);
      if (index >= width) {
        visit(index, index - width);
        if (x) visit(index, index - width - 1);
        if (x + 1 < width) visit(index, index - width + 1);
      }
    }
  }
  for (let index = alpha.length - 1; index >= 0; index--) {
    if (nearest[index] === index) continue;
    const x = index % width;
    if (x + 1 < width) visit(index, index + 1);
    if (index + width < width * height) {
      visit(index, index + width);
      if (x) visit(index, index + width - 1);
      if (x + 1 < width) visit(index, index + width + 1);
    }
  }
  return nearest;
}

function axis(position: number, from: number, to: number) {
  return Math.max(0, Math.min(to - 1, (position + 0.5) * to / from - 0.5));
}

function resizedGuide(frame: ImageData, width: number, height: number) {
  // Normally the stored matte has exactly the aspect ratio of the preview.
  // Sample to its exact dimensions even when the preview rounds differently.
  const smaller = resizePreview(frame, Math.max(width, height));
  const guide = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = Math.round(axis(y, height, smaller.height)) * smaller.width;
    for (let x = 0; x < width; x++) {
      const from = 4 * (row + Math.round(axis(x, width, smaller.width)));
      const to = 4 * (y * width + x);
      for (let c = 0; c < 4; c++) guide[to + c] = smaller.data[from + c];
    }
  }
  return guide;
}

function matteAt(
  alpha: Uint8Array, guide: Uint8ClampedArray, width: number, height: number,
  x: number, y: number, rgb: Uint8ClampedArray, pixel: number,
) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const a = top * width + left;
  const b = top * width + right;
  const c = bottom * width + left;
  const d = bottom * width + right;
  if (alpha[a] === alpha[b] && alpha[a] === alpha[c] && alpha[a] === alpha[d]) return alpha[a] / 255;

  function similarity(index: number) {
    const pos = 4 * index;
    const error = Math.abs(rgb[pixel] - guide[pos]) + Math.abs(rgb[pixel + 1] - guide[pos + 1]) +
      Math.abs(rgb[pixel + 2] - guide[pos + 2]);
    return 1 / (1 + error ** 2 / 3600);
  }
  const dx = x - left;
  const dy = y - top;
  const wa = (1 - dx) * (1 - dy) * similarity(a);
  const wb = dx * (1 - dy) * similarity(b);
  const wc = (1 - dx) * dy * similarity(c);
  const wd = dx * dy * similarity(d);
  return (wa * alpha[a] + wb * alpha[b] + wc * alpha[c] + wd * alpha[d]) / (255 * (wa + wb + wc + wd));
}

function blurredBackground(frame: ImageData, color: string) {
  const small = resizePreview(frame, 256);
  const source = flatten(new ImageData(small.data.slice(), small.width, small.height), color);
  const { width, height, data } = source;
  const radius = Math.max(1, Math.round(Math.max(width, height) * 0.055));
  const spare = new Uint8ClampedArray(data.length);
  function pass(input: Uint8ClampedArray, output: Uint8ClampedArray, horizontal: boolean) {
    const length = horizontal ? width : height;
    const lines = horizontal ? height : width;
    const step = horizontal ? 4 : width * 4;
    const lineStep = horizontal ? width * 4 : 4;
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 3; c++) {
        const start = line * lineStep + c;
        const at = (index: number) => input[start + step * Math.max(0, Math.min(length - 1, index))];
        let sum = 0;
        for (let j = -radius; j <= radius; j++) sum += at(j);
        for (let i = 0; i < length; i++) {
          output[start + i * step] = sum / (2 * radius + 1);
          sum += at(i + radius + 1) - at(i - radius);
        }
      }
    }
  }
  pass(data, spare, true);
  pass(spare, data, false);
  pass(data, spare, true);
  pass(spare, data, false);
  return source;
}

export async function compositeBackground(frame: ImageData, options: BackgroundOptions) {
  const mask = options.mask;
  if (!mask) return frame;
  const alpha = new Uint8Array(await mask.alpha.arrayBuffer());
  const guide = resizedGuide(frame, mask.width, mask.height);
  const nearest = nearestBackground(alpha, mask.width, mask.height, guide);
  const maxDistance = Math.max(8, Math.round(Math.min(mask.width, mask.height) * 0.06)) ** 2;
  const blur = options.mode === 'blur' ? blurredBackground(frame, options.color) : undefined;
  const painted = options.mode !== 'transparent';
  const color = Number.parseInt(options.color.slice(1), 16);
  const solid = [color >> 16, color >> 8 & 255, color & 255];
  const { data, width, height } = frame;
  for (let y = 0; y < height; y++) {
    const my = axis(y, height, mask.height);
    const blurY = blur ? Math.round(axis(y, height, blur.height)) * blur.width : 0;
    for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      const mx = axis(x, width, mask.width);
      const strength = matteAt(alpha, guide, mask.width, mask.height, mx, my, data, pixel);
      const sourceAlpha = data[pixel + 3] / 255;
      const opacity = strength * sourceAlpha;
      if (opacity >= 1) continue;
      const cell = Math.round(my) * mask.width + Math.round(mx);
      const bg = nearest[cell];
      const unmix = strength > 0.075 && strength < 0.995 && sourceAlpha >= 0.98 &&
        bg >= 0 && distanceSquared(bg, cell, mask.width) <= maxDistance;
      const blurPixel = blur ? (blurY + Math.round(axis(x, width, blur.width))) * 4 : 0;
      for (let c = 0; c < 3; c++) {
        const observed = data[pixel + c];
        const foreground = unmix
          ? Math.max(0, Math.min(255, (observed - (1 - strength) * guide[bg * 4 + c]) / strength))
          : observed;
        const fill = blur ? blur.data[blurPixel + c] : solid[c];
        data[pixel + c] = painted ? opacity * foreground + (1 - opacity) * fill : foreground;
      }
      data[pixel + 3] = painted ? 255 : Math.round(255 * opacity);
    }
  }
  return frame;
}
