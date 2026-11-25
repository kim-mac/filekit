import type { EditCommand } from '../../core/contracts';
import type { ConvertOptions, InputFormat } from '../../tools/image/formats';

export interface ImageRequest {
  readonly id: string;
  readonly original: File;
  readonly commands: readonly EditCommand[];
}

export interface PreviewRequest extends ImageRequest {
  readonly maxEdge: number;
}

export interface ImageInfo {
  readonly format: InputFormat;
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
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

export type ImageStage = 'Decoding' | 'Rendering preview' | 'Encoding' | 'Packaging';

export interface ImageProgress {
  readonly stage: ImageStage;
  readonly id: string;
  readonly index: number;
  readonly total: number;
}

export type ProgressCallback = (progress: ImageProgress) => void;

export interface ImageWorkerApi {
  renderPreview(request: PreviewRequest, onProgress: ProgressCallback): Promise<PreviewResult>;
  exportImage(request: ImageRequest, onProgress: ProgressCallback): Promise<ImageExport>;
  exportZip(requests: readonly ImageRequest[], onProgress: ProgressCallback): Promise<ZipResult>;
}
