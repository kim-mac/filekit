export function orient(frame: ImageData, orientation: number): ImageData {
  if (orientation < 2 || orientation > 8) return frame;

  const { width, height, data } = frame;
  const pixels = new Uint32Array(data.buffer, data.byteOffset, width * height);
  if (orientation <= 4) {
    // These orientations only swap pairs, so the decoder's frame can be reused.
    if (orientation === 3) {
      pixels.reverse();
    } else if (orientation === 2) {
      for (let y = 0; y < height; y++) pixels.subarray(y * width, (y + 1) * width).reverse();
    } else {
      for (let y = 0; y < Math.floor(height / 2); y++) {
        const top = y * width;
        const bottom = (height - 1 - y) * width;
        for (let x = 0; x < width; x++) {
          const pixel = pixels[top + x];
          pixels[top + x] = pixels[bottom + x];
          pixels[bottom + x] = pixel;
        }
      }
    }
    return frame;
  }

  const rotated = new ImageData(height, width);
  const output = new Uint32Array(rotated.data.buffer);
  const reverseX = orientation === 6 || orientation === 7;
  const reverseY = orientation === 7 || orientation === 8;
  for (let y = 0; y < height; y++) {
    const xOut = reverseX ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const yOut = reverseY ? width - 1 - x : x;
      output[yOut * height + xOut] = pixels[y * width + x];
    }
  }
  return rotated;
}

export function hasTransparency(frame: ImageData): boolean {
  const { data } = frame;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

export function flatten(frame: ImageData, background: string): ImageData {
  const color = Number.parseInt(background.slice(1), 16);
  const red = color >>> 16;
  const green = (color >>> 8) & 255;
  const blue = color & 255;
  const { data } = frame;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] === 255) continue;
    const alpha = data[index] / 255;
    data[index - 3] = alpha * data[index - 3] + (1 - alpha) * red;
    data[index - 2] = alpha * data[index - 2] + (1 - alpha) * green;
    data[index - 1] = alpha * data[index - 1] + (1 - alpha) * blue;
    data[index] = 255;
  }
  return frame;
}

export function resizePreview(frame: ImageData, maxEdge: number): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(frame.width, frame.height), Math.sqrt(16_000_000 / (frame.width * frame.height)));
  if (scale === 1) return frame;
  const width = Math.max(1, Math.floor(frame.width * scale));
  const height = Math.max(1, Math.floor(frame.height * scale));
  const preview = new ImageData(width, height);
  const source = new Uint32Array(frame.data.buffer, frame.data.byteOffset, frame.width * frame.height);
  const target = new Uint32Array(preview.data.buffer);
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y + 0.5) * frame.height / height) * frame.width;
    for (let x = 0; x < width; x++) {
      target[y * width + x] = source[row + Math.floor((x + 0.5) * frame.width / width)];
    }
  }
  return preview;
}
