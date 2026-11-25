import type { Scores } from './protocol';

function boundary(mask: Uint8Array, width: number, height: number) {
  const points: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] && (!x || x === width - 1 || !y || y === height - 1
        || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width])) {
        points.push(i);
      }
    }
  }
  return points;
}

function hits(from: number[], to: number[], width: number, height: number, tolerance: number) {
  const target = new Uint8Array(width * height);
  for (const i of to) target[i] = 1;
  return from.reduce((count, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    for (let dy = -tolerance; dy <= tolerance; dy++) {
      if (y + dy < 0 || y + dy >= height) continue;
      for (let dx = -tolerance; dx <= tolerance; dx++) {
        if (x + dx >= 0 && x + dx < width && dx * dx + dy * dy <= tolerance * tolerance
          && target[(y + dy) * width + x + dx]) return count + 1;
      }
    }
    return count;
  }, 0);
}

export function maskScores(
  predicted: Uint8Array, truth: Uint8Array, width: number, height: number, tolerance = 2,
): Scores {
  if (predicted.length !== width * height || predicted.length !== truth.length) {
    throw new Error('Mask dimensions differ');
  }
  const a = predicted.map(value => Number(value >= 128));
  const b = truth.map(value => Number(value >= 128));
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    intersection += a[i] & b[i];
    union += a[i] | b[i];
  }

  const aBoundary = boundary(a, width, height);
  const bBoundary = boundary(b, width, height);
  const precision = aBoundary.length ? hits(aBoundary, bBoundary, width, height, tolerance) / aBoundary.length : 0;
  const recall = bBoundary.length ? hits(bBoundary, aBoundary, width, height, tolerance) / bBoundary.length : 0;
  const boundaryF = !union ? 1 : precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { iou: union ? intersection / union : 1, boundaryF };
}
