import type { IconSize, ResolvedOutput } from './formats';
import type { Bounds, Orientation, Size } from './geometry';

export interface EstimateRequest {
  readonly preview: Blob;
  readonly output: ResolvedOutput;
  readonly size: Size;
  readonly crop?: { readonly bounds: Bounds; readonly orientation: Orientation };
}

export function extrapolateBytes(bytes: number, sample: Size, output: Size) {
  return Math.max(1, Math.round(bytes * output.width * output.height / (sample.width * sample.height)));
}

export function bmpBytes({ width, height }: Size) {
  return 54 + Math.ceil(width * 3 / 4) * 4 * height;
}

export function formatBytes(bytes: number) {
  const unit = bytes >= 1_000_000_000 ? ['GB', 1_000_000_000] as const
    : bytes >= 1_000_000 ? ['MB', 1_000_000] as const
    : bytes >= 1_000 ? ['kB', 1_000] as const : ['B', 1] as const;
  return `${(bytes / unit[1]).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit[0]}`;
}

export function formatDimensions({ width, height }: Size) {
  return `${width} × ${height} px`;
}

export function formatIconDimensions(sizes: readonly IconSize[]) {
  return `${sizes.map(size => `${size} × ${size}`).join(', ')} px`;
}
