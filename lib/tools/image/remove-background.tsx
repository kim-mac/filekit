import { Scissors } from 'lucide-react';
import { lazy } from 'react';
import type { ToolDefinition } from '../../core/contracts';
import { defaultBackground, parseBackground, type BackgroundOptions } from './background-options';
import type { ImageToolContext } from './context';
import type { ImageState } from './formats';

const RemoveBackgroundOptionsPanel = lazy(() => import('./remove-background-panel'));

export const removeBackgroundTool: ToolDefinition<ImageState, BackgroundOptions, ImageState, ImageToolContext> = {
  id: 'remove-background',
  name: 'Remove background',
  category: 'image',
  icon: Scissors,
  rememberOptions: true,
  defaultOptions: defaultBackground,
  parseOptions: parseBackground,
  OptionsPanel: RemoveBackgroundOptionsPanel,
  async prepareOptions(options, { original, aiResults, releaseImageMemory }, signal, report) {
    if (options.mask) return options;
    const { generateBackgroundMask } = await import('../../workers/bg0/client');
    const mask = await generateBackgroundMask(original, aiResults, releaseImageMemory, signal, report);
    return { ...options, mask };
  },
  async apply(input, options) {
    if (!options.mask) throw new Error('Generate a background mask before applying this edit.');
    return { ...input, backgroundEdit: options, backgroundAfterBlur: input.blurEdits?.length };
  },
};
