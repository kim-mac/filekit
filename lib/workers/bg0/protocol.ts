import type { ToolProgress } from '../../core/contracts';
import type { BackgroundModel } from '../../tools/image/background-model';
import type { BackgroundMask } from '../../tools/image/background-options';

export interface RemovalRequest {
  original: Blob;
  model: BackgroundModel;
  mobile: boolean;
  touchPoints: number;
  forceWasm?: boolean;
  // Used by the development benchmark so successful fallback is labeled accurately.
  bench?: boolean;
}
export interface RemovalUpdate extends ToolProgress {
  full?: boolean;
}
export interface BackgroundWorkerApi {
  autoModel(touchPoints: number): Promise<'full' | 'lite'>;
  prepare(request: Omit<RemovalRequest, 'original'>): Promise<'webgpu' | 'wasm'>;
  makeMask(request: RemovalRequest, report: (update: RemovalUpdate) => void): Promise<BackgroundMask>;
}
