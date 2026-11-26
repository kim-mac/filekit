import type { EditCommand, ToolProgress } from '../../core/contracts';
import type { ImageAIResults } from './ai-results';
import type { SizeEstimator } from '../../../components/workspace/output-estimate';
import type { InputFormat, ResolvedOutput } from './formats';
import type { Size } from './geometry';
import type { UpscaleQuality } from './upscale-options';

export interface ImageToolContext {
  readonly original: File;
  readonly editKey: string;
  readonly aiResults: ImageAIResults;
  readonly releaseImageMemory: () => Promise<void> | undefined;
  readonly originalFormat: InputFormat;
  readonly output: ResolvedOutput;
  readonly estimator: SizeEstimator;
  readonly hasAlpha: boolean;
  readonly size: Size;
  readonly previewUrl?: string;
  readonly previewBlob?: Blob;
  readonly upscale?: UpscaleQuality;
  readonly preparePreview: (command: EditCommand, signal: AbortSignal, report: (update: ToolProgress) => void) => Promise<void>;
  readonly renderDraft: (command: EditCommand) => Promise<ImageData | undefined>;
  readonly previewTarget: HTMLElement | null;
  readonly setDraftSize: (size?: Size) => void;
  readonly disabled: boolean;
}
