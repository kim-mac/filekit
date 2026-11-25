import { CategoryRegistry } from '../../core/registry';
import { convertTool, type ImageToolContext } from './convert';
import type { ImageState } from './formats';

export const imageTools = new CategoryRegistry<ImageState, ImageToolContext>('image');

imageTools.register(convertTool);
