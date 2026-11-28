import { isBackgroundModel, type BackgroundModel } from './background-model';

export interface BackgroundMask {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly alpha: Blob;
  readonly tier: 'Full' | 'Lite';
  readonly provider: 'webgpu' | 'wasm';
  readonly requestedModel?: BackgroundModel;
  readonly fellBack?: boolean;
  readonly outputMaxEdge?: number;
}

export interface BackgroundOptions {
  readonly mode: 'transparent' | 'solid' | 'blur';
  readonly color: string;
  readonly mask?: BackgroundMask;
}

export const defaultBackground: BackgroundOptions = { mode: 'transparent', color: '#ffffff' };

export function parseBackground(value: unknown): BackgroundOptions {
  if (!value || typeof value !== 'object') throw new Error('Invalid background options.');
  const { mode, color, mask } = value as Partial<BackgroundOptions>;
  if (mode !== 'transparent' && mode !== 'solid' && mode !== 'blur') throw new Error('Choose a background.');
  if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Choose a valid background color.');
  if (mask !== undefined && (typeof mask?.id !== 'string' ||
    !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 1 || mask.height < 1 ||
    mask.width > 2048 || mask.height > 2048 || !(mask.alpha instanceof Blob) ||
    mask.alpha.size !== mask.width * mask.height || !['Full', 'Lite'].includes(mask.tier) ||
    !['webgpu', 'wasm'].includes(mask.provider) ||
    (mask.requestedModel !== undefined && !isBackgroundModel(mask.requestedModel)) ||
    (mask.fellBack !== undefined && typeof mask.fellBack !== 'boolean') ||
    (mask.outputMaxEdge !== undefined && mask.outputMaxEdge !== 1280))) {
    throw new Error('Invalid background mask. Remove the background again.');
  }
  return { mode, color: color.toLowerCase(), mask };
}

export function sameBackground(a?: BackgroundOptions, b?: BackgroundOptions) {
  return a?.mask?.id === b?.mask?.id && a?.mode === b?.mode && a?.color === b?.color;
}
