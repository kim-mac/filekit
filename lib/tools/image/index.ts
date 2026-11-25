import { CategoryRegistry } from '../../core/registry';
import type { ImageToolContext } from './context';
import { blurTool } from './blur';
import { convertTool } from './convert';
import { cropTool } from './crop';
import { removeBackgroundTool } from './remove-background';
import type { ImageState } from './formats';

export const imageTools = new CategoryRegistry<ImageState, ImageToolContext>('image');

imageTools.register(convertTool);
imageTools.register(cropTool);
imageTools.register(blurTool);
imageTools.register(removeBackgroundTool);
