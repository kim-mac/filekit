import type { Size } from './geometry';

export interface ImageToolContext {
  readonly original: File;
  readonly releaseImageMemory: () => Promise<void> | undefined;
  readonly backgroundColor?: string;
  readonly hasAlpha: boolean;
  readonly size: Size;
  readonly previewUrl?: string;
  readonly previewTarget: HTMLElement | null;
  readonly disabled: boolean;
}
