import type { Size } from './geometry';

export interface UpscaleOptions {
  readonly scale: 2 | 4;
  readonly mode: 'photo' | 'art';
  readonly mobile: boolean;
}

export interface UpscaleQuality {
  readonly model: string;
  readonly provider: 'webgpu' | 'wasm';
}

export const defaultUpscale: UpscaleOptions = { scale: 2, mode: 'photo', mobile: false };

export function parseUpscale(value: unknown): UpscaleOptions {
  const options = value as Partial<UpscaleOptions> | undefined;
  if (!options || (options.scale !== 2 && options.scale !== 4) ||
    (options.mode !== 'photo' && options.mode !== 'art') || typeof options.mobile !== 'boolean') {
    throw new Error('Choose a scale and an upscale mode.');
  }
  return { scale: options.scale, mode: options.mode, mobile: options.mobile };
}

export function isMobileUpscale() {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(agent) ||
    (agent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function upscaleLimits(mobile: boolean) {
  return mobile ? { pixels: 16_000_000, edge: 8192 } : { pixels: 64_000_000, edge: 16380 };
}

export function upscaleSize({ width, height }: Size, scale: UpscaleOptions['scale']): Size {
  return { width: width * scale, height: height * scale };
}

export function upscaleLimitError({ width, height }: Size, mobile: boolean) {
  const { pixels, edge } = upscaleLimits(mobile);
  if (width * height <= pixels && Math.max(width, height) <= edge) return;
  return `This device supports up to ${pixels / 1_000_000} MP and ${edge.toLocaleString('en-US')} px per side. Crop the image or choose a smaller scale.`;
}
