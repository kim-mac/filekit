import type { EditCommand, ToolProgress } from '../../core/contracts';
import type { ImageAIResults } from './ai-results';
import type { InputFormat } from './formats';
import type { Size } from './geometry';
import type { UpscaleQuality } from './upscale-options';

export interface ImageToolContext {
  readonly original: File;
  readonly editKey: string;
  readonly aiResults: ImageAIResults;
  readonly releaseImageMemory: () => Promise<void> | undefined;
  readonly originalFormat: InputFormat;
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
