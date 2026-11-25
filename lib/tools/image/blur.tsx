import { ScanLine } from 'lucide-react';
import { lazy } from 'react';
import type { ToolDefinition } from '../../core/contracts';
import { defaultBlur, parseBlur, type BlurOptions } from './blur-options';
import type { ImageToolContext } from './context';
import type { ImageState } from './formats';

export const blurTool: ToolDefinition<ImageState, BlurOptions, ImageState, ImageToolContext> = {
  id: 'blur',
  name: 'Blur',
  category: 'image',
  icon: ScanLine,
  OptionsPanel: lazy(() => import('./blur-panel')),
  defaultOptions: defaultBlur,
  parseOptions: parseBlur,
  async apply(input, options) {
    if (!options.inverted && !options.regions.length) return input;
    return { ...input, blurEdits: [...(input.blurEdits ?? []), { geometry: input.geometry, options }] };
  },
};
