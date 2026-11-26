import type { EditCommand } from '../../core/contracts';
import type { Size } from './geometry';

export interface ImageToolContext {
  readonly original: File;
  readonly releaseImageMemory: () => Promise<void> | undefined;
  readonly backgroundColor?: string;
  readonly hasAlpha: boolean;
  readonly size: Size;
  readonly previewUrl?: string;
  readonly previewBlob?: Blob;
  readonly renderDraft: (command: EditCommand) => Promise<ImageData | undefined>;
  readonly previewTarget: HTMLElement | null;
  readonly disabled: boolean;
}
