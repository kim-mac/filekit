import { fullGeometry, orientedSize, orientationMatrix, sameGeometry, type ImageGeometry } from '../../tools/image/geometry';

export function orient(frame: ImageData, orientation: number): ImageData {
  switch (orientation) {
    case 2: return flip(frame, true, false);
    case 3: return flip(frame, true, true);
    case 4: return flip(frame, false, true);
    case 5: return transpose(frame);
    case 6: return flip(transpose(frame), true, false);
    case 7: return flip(transpose(frame), true, true);
    case 8: return flip(transpose(frame), false, true);
    default: return frame;
  }
}

export function renderGeometry(
  frame: ImageData, geometry: ImageGeometry, mode: 'preserve' | 'orient' | 'compact' = 'preserve',
): ImageData {
  const { orientation, bounds: { left, top, right, bottom } } = geometry;
  const { data } = frame;
  if (sameGeometry(geometry, fullGeometry(frame, orientation))) {
    if (mode !== 'preserve' || orientation === 1) return orient(frame, orientation);
  }
  if (mode === 'preserve') return copyGeometry(frame, geometry);

  const width = right - left;
  const height = bottom - top;
  const length = width * height * 4;
  // Compact large crops in place. For small crops, allocate at most a quarter
  // of the source size so its much larger buffer can be released before encoding.
  const compact = mode === 'compact' && length > data.length / 4;
  const cropped = compact ? data.subarray(0, length) : new Uint8ClampedArray(length);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const from = ((top + row) * frame.width + left) * 4;
    const to = row * rowBytes;
    if (compact) data.copyWithin(to, from, from + rowBytes);
    else cropped.set(data.subarray(from, from + rowBytes), to);
  }
  return orient(new ImageData(cropped, width, height), orientation);
}

function copyGeometry(frame: ImageData, { orientation, bounds: { left, top, right, bottom } }: ImageGeometry) {
  const width = right - left;
  const height = bottom - top;
  const size = orientedSize({ width, height }, orientation);
  const preview = new ImageData(size.width, size.height);
  const source = new Uint32Array(frame.data.buffer, frame.data.byteOffset, frame.width * frame.height);
  const target = new Uint32Array(preview.data.buffer);
  const [a, b, c, d] = orientationMatrix[orientation];
  const stepX = a + b * size.width;
  const stepY = c + d * size.width;
  const startX = a < 0 || c < 0 ? size.width - 1 : 0;
  const startY = b < 0 || d < 0 ? size.height - 1 : 0;
  const start = startY * size.width + startX;

  // Traverse in tiles when copying to a transposed raster so neighboring
  // reads and writes stay close in memory.
  const tile = orientation >= 5 ? 32 : width;
  for (let x0 = 0; x0 < width; x0 += tile) {
    const end = Math.min(width, x0 + tile);
    for (let y = 0; y < height; y++) {
      let from = (y + top) * frame.width + left + x0;
      let to = start + y * stepY + x0 * stepX;
      for (let x = x0; x < end; x++, from++, to += stepX) target[to] = source[from];
    }
  }
  return preview;
}

function transpose({ width, height, data }: ImageData): ImageData {
  const pixels = new Uint32Array(data.buffer, data.byteOffset, width * height);
  if (width === height) {
    for (let y = 0; y < height; y++) {
      for (let x = y + 1; x < width; x++) {
        const first = y * width + x;
        const second = x * width + y;
        const pixel = pixels[first];
        pixels[first] = pixels[second];
        pixels[second] = pixel;
      }
    }
  } else if (width > 1 && height > 1) {
    // A rectangular transpose is a permutation. Follow its cycles using
    // one bit per pixel so the decoder's RGBA buffer can be reused.
    const visited = new Uint8Array(Math.ceil(pixels.length / 8));
    for (let start = 0; start < pixels.length; start++) {
      if (visited[start >>> 3] & (1 << (start & 7))) continue;
      const pixel = pixels[start];
      let target = start;
      while (true) {
        visited[target >>> 3] |= 1 << (target & 7);
        const source = (target % height) * width + Math.floor(target / height);
        if (source === start) break;
        pixels[target] = pixels[source];
        target = source;
      }
      pixels[target] = pixel;
    }
  }
  return new ImageData(data, height, width);
}

function flip(frame: ImageData, horizontal: boolean, vertical: boolean): ImageData {
  const { width, height, data } = frame;
  const pixels = new Uint32Array(data.buffer, data.byteOffset, width * height);
  if (horizontal && vertical) {
    pixels.reverse();
  } else if (horizontal) {
    for (let y = 0; y < height; y++) pixels.subarray(y * width, (y + 1) * width).reverse();
  } else if (vertical) {
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

export const previewMaxEdge = 2048;

function previewSize({ width, height }: ImageData, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function resizePreview(frame: ImageData, maxEdge: number): ImageData {
  const { width, height } = previewSize(frame, maxEdge);
  const { width: sourceWidth, height: sourceHeight, data } = frame;
  if (width === sourceWidth && height === sourceHeight) return frame;
  const preview = new ImageData(width, height);
  const output = preview.data;

  // Exact area weights in integer units. Average alpha and premultiplied
  // color separately so transparent edges do not pick up hidden RGB.
  const area = sourceWidth * sourceHeight;
  for (let y = 0; y < height; y++) {
    const top = y * sourceHeight;
    const bottom = top + sourceHeight;
    const firstRow = Math.floor(top / height);
    const endRow = Math.ceil(bottom / height);
    for (let x = 0; x < width; x++) {
      const left = x * sourceWidth;
      const right = left + sourceWidth;
      const firstColumn = Math.floor(left / width);
      const endColumn = Math.ceil(right / width);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let row = firstRow; row < endRow; row++) {
        const rowWeight = Math.min(bottom, (row + 1) * height) - Math.max(top, row * height);
        let index = (row * sourceWidth + firstColumn) * 4;
        for (let column = firstColumn; column < endColumn; column++, index += 4) {
          const columnWeight = Math.min(right, (column + 1) * width) - Math.max(left, column * width);
          const weight = rowWeight * columnWeight * data[index + 3];
          alpha += weight;
          red += weight * data[index];
          green += weight * data[index + 1];
          blue += weight * data[index + 2];
        }
      }
      const index = (y * width + x) * 4;
      if (alpha) {
        output[index] = red / alpha;
        output[index + 1] = green / alpha;
        output[index + 2] = blue / alpha;
      }
      output[index + 3] = Math.floor(alpha / area);
    }
  }
  return preview;
}
