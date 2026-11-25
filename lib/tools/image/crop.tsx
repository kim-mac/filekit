import { Crop } from 'lucide-react';
import { lazy } from 'react';
import type { ToolDefinition } from '../../core/contracts';
import type { ImageToolContext } from './context';
import type { ImageState } from './formats';
import { editGeometry, fullBounds, isOrientation, type Bounds, type Orientation } from './geometry';

const CropOptionsPanel = lazy(() => import('./crop-panel'));

export const cropPresets = { Free: 0, '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9, '9:16': 9 / 16 } as const;
export type CropPreset = keyof typeof cropPresets;

export interface CropOptions {
  readonly bounds: Bounds;
  readonly orientation: Orientation;
  readonly preset?: CropPreset;
}

export const cropTool: ToolDefinition<ImageState, CropOptions, ImageState, ImageToolContext> = {
  id: 'crop',
  name: 'Crop',
  category: 'image',
  icon: Crop,
  OptionsPanel: CropOptionsPanel,
  defaultOptions: { bounds: fullBounds, orientation: 1 },
  parseOptions(value) {
    if (typeof value !== 'object' || value === null) throw new Error('Invalid crop options.');
    const { bounds, orientation, preset } = value as Partial<CropOptions>;
    if (!isOrientation(orientation) || !bounds ||
      ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
      bounds.left < 0 || bounds.top < 0 || bounds.right > 1 || bounds.bottom > 1 ||
      bounds.left >= bounds.right || bounds.top >= bounds.bottom ||
      (preset !== undefined && !Object.hasOwn(cropPresets, preset))) {
      throw new Error('Crop bounds must describe a non-empty area within the image.');
    }
    return { bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }, orientation, preset };
  },
  async apply(input, { bounds, orientation }) {
    return { ...input, geometry: editGeometry(input.geometry, bounds, orientation) };
  },
};
