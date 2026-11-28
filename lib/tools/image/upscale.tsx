import { Maximize } from 'lucide-react';
import { isMobileDevice } from '../../core/device';
import { lazy } from 'react';
import type { ToolDefinition } from '../../core/contracts';
import type { ImageToolContext } from './context';
import type { ImageState } from './formats';
import { defaultUpscale, parseUpscale, upscaleLimitError, upscaleSize, type UpscaleOptions } from './upscale-options';

const UpscaleOptionsPanel = lazy(() => import('./upscale-panel'));

export const upscaleTool: ToolDefinition<ImageState, UpscaleOptions, ImageState, ImageToolContext> = {
  id: 'upscale',
  name: 'Upscale',
  category: 'image',
  icon: Maximize,
  defaultOptions: defaultUpscale,
  parseOptions: parseUpscale,
  mayTakeAMinute(options, { size }) {
    const output = upscaleSize(size, options.scale);
    return output.width * output.height >= 4_000_000;
  },
  getApplyError(options, { size }) {
    return upscaleLimitError(upscaleSize(size, options.scale), isMobileDevice());
  },
  OptionsPanel: UpscaleOptionsPanel,
  async prepareOptions(options, context, signal, report) {
    const value = { ...options, mobile: isMobileDevice() };
    await context.preparePreview({ toolId: 'upscale', options: value }, signal, report);
    return value;
  },
  async apply(input, options) {
    return { ...input, upscaleEdit: options };
  },
};
