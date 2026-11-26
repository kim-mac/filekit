import type { BackgroundOptions } from './background-options';
import type { BlurEdit } from './blur-options';
import type { ImageGeometry } from './geometry';
import type { UpscaleOptions } from './upscale-options';

export const outputFormats = {
  jpeg: { label: 'JPG (JPEG)', mime: 'image/jpeg', extension: 'jpg', lossy: true, alpha: false },
  png: { label: 'PNG', mime: 'image/png', extension: 'png', lossy: false, alpha: true },
  webp: { label: 'WebP', mime: 'image/webp', extension: 'webp', lossy: true, alpha: true },
  avif: { label: 'AVIF', mime: 'image/avif', extension: 'avif', lossy: true, alpha: true },
  gif: { label: 'GIF', mime: 'image/gif', extension: 'gif', lossy: false, alpha: true },
  bmp: { label: 'BMP', mime: 'image/bmp', extension: 'bmp', lossy: false, alpha: false },
  tiff: { label: 'TIFF', mime: 'image/tiff', extension: 'tiff', lossy: false, alpha: true },
  ico: { label: 'ICO', mime: 'image/vnd.microsoft.icon', extension: 'ico', lossy: false, alpha: true },
} as const;

export type OutputFormat = keyof typeof outputFormats;
export type InputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'heic';
export type OutputSelection = 'original' | OutputFormat;
export const iconSizes = [16, 32, 48, 64, 128, 256] as const;
export type IconSize = typeof iconSizes[number];

export interface ConvertOptions {
  readonly format: OutputSelection;
  readonly quality: number;
  readonly background: string;
  readonly iconSizes?: readonly IconSize[];
}

export interface ResolvedOutput extends ConvertOptions {
  readonly format: OutputFormat;
}

export interface ImageState {
  readonly geometry: ImageGeometry;
  readonly backgroundEdit?: BackgroundOptions;
  readonly backgroundAfterBlur?: number;
  readonly blurEdits?: readonly BlurEdit[];
  readonly upscaleEdit?: UpscaleOptions;
  readonly output: ConvertOptions;
}

export const defaultConvertOptions = { format: 'png', quality: 85, background: '#ffffff' } as const satisfies ResolvedOutput;
export const keepOriginalOptions: ConvertOptions = { ...defaultConvertOptions, format: 'original' };

export function resolveOutput(format: InputFormat, options: ConvertOptions): ResolvedOutput {
  return { ...options, format: options.format === 'original' ? (format === 'heic' ? 'jpeg' : format) : options.format };
}

export function outputName(input: string, format: OutputFormat): string {
  const stem = input.replace(/\.[^.]+$/, '').replace(/[\/\\\x00-\x1f\x7f]/g, '_');
  return `${stem || 'image'}.${outputFormats[format].extension}`;
}
