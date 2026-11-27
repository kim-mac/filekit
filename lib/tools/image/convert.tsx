import { Repeat2 } from 'lucide-react';
import { lazy } from 'react';
import type { ToolDefinition } from '../../core/contracts';
import type { ImageToolContext } from './context';
import { iconSizes, keepOriginalOptions, outputFormats, type ConvertOptions, type IconSize, type ImageState, type OutputSelection } from './formats';

const ConvertOptionsPanel = lazy(() => import('./convert-panel'));

export const convertTool: ToolDefinition<ImageState, ConvertOptions, ImageState, ImageToolContext> = {
  id: 'convert',
  name: 'Convert',
  category: 'image',
  icon: Repeat2,
  OptionsPanel: ConvertOptionsPanel,
  defaultOptions: keepOriginalOptions,
  parseOptions(value) {
    if (typeof value !== 'object' || value === null) throw new Error('Invalid conversion options.');
    const { format, quality, background, iconSizes: sizes } = value as Record<string, unknown>;
    if (typeof format !== 'string' || (format !== 'original' && !Object.hasOwn(outputFormats, format))) {
      throw new Error('Choose a supported output format.');
    }
    if (typeof quality !== 'number' || !Number.isInteger(quality) || quality < 1 || quality > 100) {
      throw new Error('Quality must be a whole number from 1 to 100.');
    }
    if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/i.test(background)) {
      throw new Error('Choose a valid fill color.');
    }
    if (sizes !== undefined && (!Array.isArray(sizes) || !sizes.length || sizes.some(size => !iconSizes.includes(size)))) {
      throw new Error('Choose at least one supported icon size.');
    }
    const options = { format: format as OutputSelection, quality, background };
    return sizes ? { ...options, iconSizes: iconSizes.filter(size => (sizes as IconSize[]).includes(size)) } : options;
  },
  async apply(input, options) {
    return { ...input, output: options };
  },
};
