export const outputFormats = {
  jpeg: { label: 'JPG', mime: 'image/jpeg', extension: 'jpg', lossy: true },
  png: { label: 'PNG', mime: 'image/png', extension: 'png', lossy: false },
  webp: { label: 'WebP', mime: 'image/webp', extension: 'webp', lossy: true },
  avif: { label: 'AVIF', mime: 'image/avif', extension: 'avif', lossy: true },
} as const;

export type OutputFormat = keyof typeof outputFormats;
export type InputFormat = OutputFormat | 'gif' | 'heic';

export interface ConvertOptions {
  readonly format: OutputFormat;
  readonly quality: number;
  readonly background: string;
}

export interface ImageState {
  readonly frame: ImageData;
  readonly output: ConvertOptions;
}

export const defaultConvertOptions: ConvertOptions = { format: 'png', quality: 85, background: '#ffffff' };

export function defaultOutput(format: InputFormat): ConvertOptions {
  return {
    ...defaultConvertOptions,
    format: format === 'heic' || format === 'gif' ? 'png' : format,
  };
}

export function outputName(input: string, format: OutputFormat): string {
  const stem = input.replace(/\.[^.]+$/, '').replace(/[\/\\\x00-\x1f\x7f]/g, '_');
  return `${stem || 'image'}.${outputFormats[format].extension}`;
}
