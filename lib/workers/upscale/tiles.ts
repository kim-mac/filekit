import type { Size } from '../../tools/image/geometry';
import { upscaleSize } from '../../tools/image/upscale-options';
import { hasTransparency } from '../image/pixels';

export interface TileAxis {
  readonly start: number;
  readonly end: number;
  readonly readStart: number;
  readonly readEnd: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
}

export function tileAxis(length: number, core: number, overlap: number, halo: number): TileAxis[] {
  if (length < 1 || overlap < 0 || halo < 0 || core < Math.max(1, 2 * overlap)) {
    throw new Error('Invalid upscale tile dimensions.');
  }
  const tiles: TileAxis[] = [];
  for (let origin = 0; origin < length; origin += core) {
    const stop = Math.min(length, origin + core);
    const fadeIn = origin > 0 && overlap > 0 ? origin : undefined;
    const fadeOut = stop < length && overlap > 0 ? stop : undefined;
    const start = fadeIn === undefined ? origin : origin - overlap;
    const end = fadeOut === undefined ? stop : Math.min(length, stop + overlap);
    tiles.push({
      start, end, fadeIn, fadeOut,
      readStart: Math.max(0, start - halo), readEnd: Math.min(length, end + halo),
    });
  }
  return tiles;
}

export function tileInput(frame: ImageData, x: TileAxis, y: TileAxis) {
  const width = x.readEnd - x.readStart;
  const height = y.readEnd - y.readStart;
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let row = 0; row < height; row++) {
    let source = ((row + y.readStart) * frame.width + x.readStart) * 4;
    for (let column = 0; column < width; column++, source += 4) {
      const i = row * width + column;
      for (let c = 0; c < 3; c++) data[i + c * plane] = frame.data[source + c] / 255;
    }
  }
  return { data, width, height };
}

function ramp(position: number, center: number, overlap: number) {
  return Math.max(0, Math.min(1, (position - center + overlap) / (2 * overlap)));
}

function weights(position: number, tile: TileAxis, overlap: number) {
  const earlier = tile.fadeIn === undefined ? 0 : 1 - ramp(position, tile.fadeIn, overlap);
  const later = tile.fadeOut === undefined ? 0 : ramp(position, tile.fadeOut, overlap);
  return { earlier, current: 1 - earlier - later };
}

function alphaAt(frame: ImageData, x: number, y: number, scale: number) {
  const sx = Math.max(0, Math.min(frame.width - 1, (x + 0.5) / scale - 0.5));
  const sy = Math.max(0, Math.min(frame.height - 1, (y + 0.5) / scale - 0.5));
  const left = Math.floor(sx);
  const top = Math.floor(sy);
  const right = Math.min(frame.width - 1, left + 1);
  const bottom = Math.min(frame.height - 1, top + 1);
  const dx = sx - left;
  const dy = sy - top;
  const at = (column: number, row: number) => frame.data[(row * frame.width + column) * 4 + 3];
  return (1 - dy) * ((1 - dx) * at(left, top) + dx * at(right, top)) +
    dy * ((1 - dx) * at(left, bottom) + dx * at(right, bottom));
}

export function blendTile(
  output: ImageData, source: ImageData, rgb: Float32Array, x: TileAxis, y: TileAxis,
  scale: 2 | 4, overlap: number, transparent: boolean,
) {
  const nativeWidth = (x.readEnd - x.readStart) * 4;
  const plane = nativeWidth * (y.readEnd - y.readStart) * 4;
  if (rgb.length !== plane * 3) throw new Error('Invalid upscale model output size.');

  const ratio = 4 / scale;
  const columns = Array.from({ length: (x.end - x.start) * scale }, (_, i) =>
    weights(x.start + (i + 0.5) / scale, x, overlap));
  for (let row = y.start * scale; row < y.end * scale; row++) {
    const vertical = weights((row + 0.5) / scale, y, overlap);
    const base = (row - y.readStart * scale) * ratio * nativeWidth;
    for (let i = 0; i < columns.length; i++) {
      const column = x.start * scale + i;
      const horizontal = columns[i];
      const incoming = vertical.current * horizontal.current;
      // Completed rows include both horizontal contributors. In this row,
      // only the tile on the left can have contributed so far.
      const prior = vertical.earlier + vertical.current * horizontal.earlier;
      const mix = incoming / (incoming + prior);
      const to = (row * output.width + column) * 4;
      const from = base + (column - x.readStart * scale) * ratio;
      for (let c = 0; c < 3; c++) {
        const k = from + c * plane;
        const value = ratio === 1 ? rgb[k] : (rgb[k] + rgb[k + 1] + rgb[k + nativeWidth] + rgb[k + nativeWidth + 1]) / 4;
        const color = Math.max(0, Math.min(255, value * 255));
        output.data[to + c] += (color - output.data[to + c]) * mix;
      }
      output.data[to + 3] = transparent ? alphaAt(source, column, row, scale) : 255;
    }
  }
}

export type TileInput = ReturnType<typeof tileInput>;

export async function upscaleTiles(
  frame: ImageData, scale: 2 | 4, tiles: { core: number; overlap: number; halo: number },
  predict: (input: TileInput) => Promise<Float32Array>, progress: (done: number, total: number) => void,
) {
  const { width, height }: Size = upscaleSize(frame, scale);
  const columns = tileAxis(frame.width, tiles.core, tiles.overlap, tiles.halo);
  const rows = tileAxis(frame.height, tiles.core, tiles.overlap, tiles.halo);
  const total = rows.length * columns.length;
  const output = new ImageData(width, height);
  const transparent = hasTransparency(frame);
  progress(0, total);
  let done = 0;
  for (const y of rows) {
    for (const x of columns) {
      const rgb = await predict(tileInput(frame, x, y));
      blendTile(output, frame, rgb, x, y, scale, tiles.overlap, transparent);
      progress(++done, total);
    }
  }
  return output;
}
