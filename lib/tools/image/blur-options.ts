import type { Bounds, ImageGeometry } from './geometry';

export interface BlurPoint {
  readonly x: number;
  readonly y: number;
}

export interface BlurShape {
  readonly kind: 'rectangle' | 'ellipse';
  readonly bounds: Bounds;
}

export interface BlurStroke {
  readonly kind: 'brush' | 'eraser';
  readonly diameter: number;
  readonly points: readonly BlurPoint[];
}

export type BlurRegion = BlurShape | BlurStroke;

export interface BlurOptions {
  readonly effect: 'gaussian' | 'pixelate';
  readonly strength: number;
  readonly blockSize: number;
  readonly inverted: boolean;
  readonly regions: readonly BlurRegion[];
}

export interface BlurEdit {
  readonly geometry: ImageGeometry;
  readonly options: BlurOptions;
}

export const defaultBlur: BlurOptions = {
  effect: 'gaussian', strength: 48, blockSize: 24, inverted: false, regions: [],
};

export function isBlurStroke(region: BlurRegion): region is BlurStroke {
  return region.kind === 'brush' || region.kind === 'eraser';
}

function unit(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function slider(value: number, min: number) {
  return Number.isInteger(value) && value >= min && value <= 100;
}

export function parseBlur(value: unknown): BlurOptions {
  const options = value as BlurOptions | undefined;
  if (!options || (options.effect !== 'gaussian' && options.effect !== 'pixelate') ||
    !slider(options.strength, 1) || !slider(options.blockSize, 2) ||
    typeof options.inverted !== 'boolean' || !Array.isArray(options.regions)) {
    throw new Error('Invalid blur options.');
  }

  for (const region of options.regions as readonly BlurRegion[]) {
    if (region && isBlurStroke(region)) {
      if (unit(region.diameter) && region.diameter > 0 && Array.isArray(region.points) && region.points.length &&
        region.points.every(point => point && unit(point.x) && unit(point.y))) continue;
    } else if (region?.kind === 'rectangle' || region?.kind === 'ellipse') {
      const bounds = region.bounds;
      if (bounds && [bounds.left, bounds.top, bounds.right, bounds.bottom].every(unit) &&
        bounds.left < bounds.right && bounds.top < bounds.bottom) continue;
    }
    throw new Error('Blur regions must describe a non-empty area within the image.');
  }
  return options;
}
