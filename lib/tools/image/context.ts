import type { EditCommand, ToolProgress } from '../../core/contracts';
import type { Size } from './geometry';
import type { UpscaleQuality } from './upscale-options';

export interface ImageToolContext {
  readonly original: File;
  readonly releaseImageMemory: () => Promise<void> | undefined;
  readonly backgroundColor?: string;
  readonly hasAlpha: boolean;
  readonly size: Size;
  readonly previewUrl?: string;
  readonly previewBlob?: Blob;
  readonly upscale?: UpscaleQuality;
  readonly preparePreview: (command: EditCommand, signal: AbortSignal, report: (update: ToolProgress) => void) => Promise<void>;
  readonly renderDraft: (command: EditCommand) => Promise<ImageData | undefined>;
  readonly previewTarget: HTMLElement | null;
  readonly disabled: boolean;
}
