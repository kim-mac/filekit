import { Scissors } from 'lucide-react';
import { lazy } from 'react';
import type { ToolDefinition } from '../../core/contracts';
import { backgroundModel } from './background-model';
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
  mayTakeAMinute(options, { size, original, aiResults }) {
    const model = backgroundModel();
    return (!options.mask || (options.mask.requestedModel ?? 'auto') !== model) &&
      aiResults.background?.mask.requestedModel !== model && (size.width * size.height >= 8_000_000 || original.size >= 8_000_000);
  },
  async prepareOptions(options, { original, aiResults, releaseImageMemory }, signal, report) {
    const model = backgroundModel();
    if (options.mask && (options.mask.requestedModel ?? 'auto') === model) return options;
    const { generateBackgroundMask } = await import('../../workers/bg0/client');
    const mask = await generateBackgroundMask(original, model, aiResults, releaseImageMemory, signal, report);
    return { ...options, mask };
  },
  async apply(input, options) {
    if (!options.mask) throw new Error('Generate a background mask before applying this edit.');
    return { ...input, backgroundEdit: options, backgroundAfterBlur: input.blurEdits?.length };
  },
};
