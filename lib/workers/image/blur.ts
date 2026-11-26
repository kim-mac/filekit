import type { BlurOptions } from '../../tools/image/blur-options';
import { fullGeometry, geometrySize, orientationMatrix, type ImageGeometry, type Size } from '../../tools/image/geometry';
import { rasterizeBlurMask, type BlurMask } from './blur-mask';
import { hasTransparency } from './pixels';

function rasterView(frame: ImageData, geometry: ImageGeometry) {
  const { width, height } = geometrySize(geometry);
  const [a, b, c, d] = orientationMatrix[geometry.orientation];
  const { left, top, right, bottom } = geometry.bounds;
  const x = a < 0 || b < 0 ? right - 1 : left;
  const y = c < 0 || d < 0 ? bottom - 1 : top;
  return {
    data: frame.data, width, height, offset: (y * frame.width + x) * 4,
    stepX: (a + c * frame.width) * 4, stepY: (b + d * frame.width) * 4,
  };
}
type RasterView = ReturnType<typeof rasterView>;

function selected({ bits, inverted }: BlurMask, index: number) {
  return Boolean(bits[index >>> 3] & (1 << (index & 7))) !== inverted;
}

function pixelate(view: RasterView, mask: BlurMask, size: Size, block: number) {
  const { data, width, height, offset, stepX, stepY } = view;
  const fullBlock = Math.max(2, Math.round(Math.max(size.width, size.height) * block / 1000));
  // Align the grid to the full-resolution frame at this history step. Map
  // full-resolution block edges to preview pixel centers without drift.
  const blockAt = (pixel: number, full: number, preview: number) => Math.floor((pixel + 0.5) * full / preview / fullBlock);
  const next = (index: number, full: number, preview: number) =>
    Math.min(preview, Math.ceil((index + 1) * fullBlock * preview / full - 0.5));

  for (let y = Math.max(0, next(blockAt(mask.top, size.height, height) - 1, size.height, height)); y < mask.bottom;) {
    const endY = next(blockAt(y, size.height, height), size.height, height);
    for (let x = Math.max(0, next(blockAt(mask.left, size.width, width) - 1, size.width, width)); x < mask.right;) {
      const endX = next(blockAt(x, size.width, width), size.width, width);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let row = y; row < endY; row++) {
        let pixel = offset + row * stepY + x * stepX;
        for (let col = x; col < endX; col++, pixel += stepX) {
          const a = data[pixel + 3];
          alpha += a;
          red += data[pixel] * a;
          green += data[pixel + 1] * a;
          blue += data[pixel + 2] * a;
        }
      }
      if (alpha) {
        const r = Math.round(red / alpha);
        const g = Math.round(green / alpha);
        const b = Math.round(blue / alpha);
        for (let row = Math.max(y, mask.top); row < Math.min(endY, mask.bottom); row++) {
          let pixel = offset + row * stepY + x * stepX;
          for (let col = x; col < endX; col++, pixel += stepX) {
            if (!selected(mask, row * width + col)) continue;
            data[pixel] = r;
            data[pixel + 1] = g;
            data[pixel + 2] = b;
          }
        }
      }
      x = endX;
    }
    y = endY;
  }
}

// Three odd-width box filters approximate a Gaussian with the given sigma.
function boxRadii(sigma: number) {
  const ideal = Math.sqrt(4 * sigma ** 2 + 1);
  const lower = Math.floor(ideal) % 2 === 0 ? Math.floor(ideal) - 1 : Math.floor(ideal);
  const narrow = Math.round((12 * sigma ** 2 - 3 * lower ** 2 - 12 * lower - 9) / (-4 * lower - 4));
  return [0, 1, 2].map(index => (lower - 1) / 2 + (index < narrow ? 0 : 1));
}

function horizontal(input: Uint8ClampedArray, output: Uint8ClampedArray, width: number, height: number, radius: number) {
  const scale = 1 / (radius * 2 + 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const last = row + width - 1;
    let sum = input[row] * (radius + 1);
    for (let x = 1; x <= radius; x++) sum += input[Math.min(last, row + x)];
    for (let x = row; x <= last; x++) {
      output[x] = sum * scale;
      sum += input[Math.min(last, x + radius + 1)] - input[Math.max(row, x - radius)];
    }
  }
}

function vertical(input: Uint8ClampedArray, output: Uint8ClampedArray, width: number, height: number, radius: number) {
  const scale = 1 / (radius * 2 + 1);
  const sums = new Int32Array(width);
  for (let x = 0; x < width; x++) sums[x] = input[x] * (radius + 1);
  for (let y = 1; y <= radius; y++) {
    const row = Math.min(height - 1, y) * width;
    for (let x = 0; x < width; x++) sums[x] += input[row + x];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const add = Math.min(height - 1, y + radius + 1) * width;
    const drop = Math.max(0, y - radius) * width;
    for (let x = 0; x < width; x++) {
      output[row + x] = sums[x] * scale;
      sums[x] += input[add + x] - input[drop + x];
    }
  }
}

function gaussian(view: RasterView, mask: BlurMask, size: Size, strength: number, transparent: boolean) {
  const { data, width, height, offset, stepX, stepY } = view;
  const sigma = Math.max(0.7, Math.max(size.width, size.height) * strength / 2000);
  const radiusX = boxRadii(sigma * width / size.width);
  const radiusY = boxRadii(sigma * height / size.height);
  const padX = radiusX.reduce((sum, radius) => sum + radius, 0);
  const padY = radiusY.reduce((sum, radius) => sum + radius, 0);
  if (!(padX || padY)) return;
  const left = Math.max(0, mask.left - padX);
  const top = Math.max(0, mask.top - padY);
  const w = Math.min(width, mask.right + padX) - left;
  const h = Math.min(height, mask.bottom + padY) - top;
  const first = new Uint8ClampedArray(w * h);
  const second = new Uint8ClampedArray(first.length);
  const alpha = transparent ? new Uint8ClampedArray(first.length) : undefined;

  function filter(channel: number) {
    for (let y = 0; y < h; y++) {
      let pixel = offset + (top + y) * stepY + left * stepX;
      for (let x = 0; x < w; x++, pixel += stepX) {
        first[y * w + x] = alpha && channel !== 3 ? data[pixel + channel] * data[pixel + 3] / 255 : data[pixel + channel];
      }
    }

    let input = first;
    let output = second;
    for (const radius of radiusX) {
      if (!radius) continue;
      horizontal(input, output, w, h, radius);
      [input, output] = [output, input];
    }
    for (const radius of radiusY) {
      if (!radius) continue;
      vertical(input, output, w, h, radius);
      [input, output] = [output, input];
    }
    return input;
  }

  // Preserve coverage, including background-removal mattes. Filter
  // premultiplied color so hidden RGB does not bleed into visible pixels.
  if (alpha) alpha.set(filter(3));
  for (let channel = 0; channel < 3; channel++) {
    const filtered = filter(channel);
    for (let y = mask.top; y < mask.bottom; y++) {
      let pixel = offset + y * stepY + mask.left * stepX;
      let index = (y - top) * w + mask.left - left;
      for (let x = mask.left; x < mask.right; x++, pixel += stepX, index++) {
        if (selected(mask, y * width + x)) {
          if (!alpha) data[pixel + channel] = filtered[index];
          else if (alpha[index]) data[pixel + channel] = filtered[index] * 255 / alpha[index];
        }
      }
    }
  }
}

export function applyRegionBlur(
  frame: ImageData, options: BlurOptions, fullSize: Size = frame, geometry = fullGeometry(frame),
) {
  const view = rasterView(frame, geometry);
  const mask = rasterizeBlurMask(view, options);
  if (mask.left >= mask.right || mask.top >= mask.bottom) return;
  if (options.effect === 'pixelate') pixelate(view, mask, fullSize, options.blockSize);
  else gaussian(view, mask, fullSize, options.strength, hasTransparency(frame));
}
