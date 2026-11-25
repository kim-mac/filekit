import type { Size } from './geometry';

export interface ImageToolContext {
  readonly hasAlpha: boolean;
  readonly size: Size;
  readonly previewUrl?: string;
  readonly previewTarget: HTMLElement | null;
  readonly disabled: boolean;
}
