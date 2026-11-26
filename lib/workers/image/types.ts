import type { EditCommand } from '../../core/contracts';
import type { UpscaleQuality } from '../../tools/image/upscale-options';
import type { ConvertOptions, InputFormat } from '../../tools/image/formats';

export interface ImageRequest {
  readonly id: string;
  readonly original: File;
  readonly commands: readonly EditCommand[];
}

export interface PreviewRequest extends ImageRequest {
  readonly maxEdge?: number;
  readonly cache?: boolean;
}

export interface ImageInfo {
  readonly format: InputFormat;
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  readonly backgroundColor?: string;
  readonly upscale?: UpscaleQuality;
  readonly output: ConvertOptions;
}

export interface PreviewResult {
  readonly blob: Blob;
  readonly info: ImageInfo;
}

export interface ImageExport {
  readonly blob: Blob;
  readonly name: string;
}

export interface FileFailure {
  readonly id: string;
  readonly message: string;
}

export interface ZipResult {
  readonly blob: Blob | null;
  readonly failures: readonly FileFailure[];
  readonly count: number;
}

export type ImageStage = 'Decoding' | 'Rendering preview' | 'Applying edits' | 'Upscaling' | 'Encoding' | 'Packaging';

export interface ImageProgress {
  readonly stage: ImageStage;
  readonly detail?: string;
  readonly tiles?: { readonly done: number; readonly total: number };
  readonly id: string;
  readonly index: number;
  readonly total: number;
}

export type ProgressCallback = (progress: ImageProgress) => void;

export interface ImageWorkerApi {
  retainPreview(id: string): void;
  releaseFullPreview(): void;
  renderDraft(request: Pick<ImageRequest, 'id' | 'commands'>): Promise<ImageData | undefined>;
  renderPreview(request: PreviewRequest, onProgress: ProgressCallback): Promise<PreviewResult>;
  exportImage(request: ImageRequest, onProgress: ProgressCallback): Promise<ImageExport>;
  exportZip(requests: readonly ImageRequest[], onProgress: ProgressCallback): Promise<ZipResult>;
}
