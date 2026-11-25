import { maskScores } from './metrics';

export function canvas(width: number, height: number) {
  const image = new OffscreenCanvas(width, height);
  const ctx = image.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D unavailable');
  ctx.imageSmoothingQuality = 'high';
  return { image, ctx };
}

export function gray(pixels: ImageData) {
  return Uint8Array.from({ length: pixels.width * pixels.height }, (_, i) => pixels.data[i * 4]);
}

export function maskImage(alpha: Uint8Array, width: number, height: number) {
  const mask = new ImageData(width, height);
  for (let i = 0; i < alpha.length; i++) {
    mask.data.set([alpha[i], alpha[i], alpha[i], 255], 4 * i);
  }
  return mask;
}

export function makeRow(original: ImageData, mask: ImageData, alpha: Uint8Array, colors: ImageData, label: string) {
  const cellWidth = 236;
  const cellHeight = 190;
  const header = 28;
  const { image, ctx } = canvas(cellWidth * 3, cellHeight + header);
  ctx.fillStyle = '#171b22';
  ctx.fillRect(0, 0, image.width, image.height);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 8, 18, image.width - 16);

  const { width, height } = original;
  const cutout = new ImageData(new Uint8ClampedArray(colors.data), width, height);
  for (let i = 0; i < alpha.length; i++) cutout.data[4 * i + 3] = alpha[i];
  const scale = Math.min((cellWidth - 8) / width, (cellHeight - 8) / height);
  const drawnWidth = Math.round(width * scale);
  const drawnHeight = Math.round(height * scale);
  const y = header + Math.floor((cellHeight - drawnHeight) / 2);
  const source = canvas(width, height);
  [original, mask, cutout].forEach((pixels, column) => {
    const x = column * cellWidth + Math.floor((cellWidth - drawnWidth) / 2);
    if (column === 2) {
      for (let row = 0; row < drawnHeight; row += 10) {
        for (let col = 0; col < drawnWidth; col += 10) {
          ctx.fillStyle = (row / 10 + col / 10) % 2 ? '#b5bec9' : '#eef0f4';
          ctx.fillRect(x + col, y + row, Math.min(10, drawnWidth - col), Math.min(10, drawnHeight - row));
        }
      }
    }
    source.ctx.putImageData(pixels, 0, 0);
    ctx.drawImage(source.image, x, y, drawnWidth, drawnHeight);
  });
  return image.convertToBlob({ type: 'image/png' });
}

export async function makeVariant(
  original: ImageData, alpha: Uint8Array, truth: Uint8Array | null, label: string,
) {
  const { width, height } = original;
  const pixels = maskImage(alpha, width, height);
  const mask = canvas(width, height);
  mask.ctx.putImageData(pixels, 0, 0);
  return {
    mask: await mask.image.convertToBlob({ type: 'image/png' }),
    row: await makeRow(original, pixels, alpha, original, label),
    scores: truth ? maskScores(alpha, truth, width, height) : null,
  };
}
