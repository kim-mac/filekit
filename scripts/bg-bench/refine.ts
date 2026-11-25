function boxMean(values: Float32Array, width: number, height: number, radius: number) {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += values[(y - 1) * width + x - 1];
      integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
    }
  }

  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const total = integral[bottom * stride + right] - integral[bottom * stride + left]
        - integral[top * stride + right] + integral[top * stride + left];
      output[y * width + x] = total / ((bottom - top) * (right - left));
    }
  }
  return output;
}

export function guidedAlpha(original: ImageData, mask: Uint8Array, radius = 4, epsilon = 0.001) {
  const { data, width, height } = original;
  const guide = Float32Array.from(mask, (_, i) => (
    0.2126 * data[4 * i] + 0.7152 * data[4 * i + 1] + 0.0722 * data[4 * i + 2]
  ) / 255);
  const alpha = Float32Array.from(mask, value => value / 255);
  const meanGuide = boxMean(guide, width, height, radius);
  const meanAlpha = boxMean(alpha, width, height, radius);
  const meanSquare = boxMean(guide.map(value => value * value), width, height, radius);
  const meanProduct = boxMean(guide.map((value, i) => value * alpha[i]), width, height, radius);
  const a = meanProduct.map((value, i) => (
    (value - meanGuide[i] * meanAlpha[i]) / (meanSquare[i] - meanGuide[i] ** 2 + epsilon)
  ));
  const b = meanAlpha.map((value, i) => value - a[i] * meanGuide[i]);
  const meanA = boxMean(a, width, height, radius);
  const meanB = boxMean(b, width, height, radius);
  return Uint8Array.from(alpha, (_, i) => Math.round(255 * Math.max(0, Math.min(1, meanA[i] * guide[i] + meanB[i]))));
}

export function decontaminate(original: ImageData, alpha: Uint8Array, radius = 12) {
  const { data, width, height } = original;
  const background = Float32Array.from(alpha, value => Number(value < 16));
  const coverage = boxMean(background, width, height, radius);
  const cleaned = new ImageData(new Uint8ClampedArray(data), width, height);
  for (let channel = 0; channel < 3; channel++) {
    const sums = boxMean(background.map((weight, i) => weight * data[4 * i + channel]), width, height, radius);
    for (let i = 0; i < alpha.length; i++) {
      const opacity = alpha[i] / 255;
      if (opacity < 0.15 || opacity > 0.95 || coverage[i] < 0.12) continue;
      const position = 4 * i + channel;
      const observed = data[position];
      const foreground = (observed - (1 - opacity) * sums[i] / coverage[i]) / opacity;
      const clamped = Math.max(0, Math.min(255, foreground));
      cleaned.data[position] = observed + 0.65 * (clamped - observed);
    }
  }
  return cleaned;
}
