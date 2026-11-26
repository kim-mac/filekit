import type { BackgroundMask } from './background-options';
import type { Bounds } from './geometry';

export interface ImageAIResults {
  background?: { readonly key: string; readonly mask: BackgroundMask };
  faces?: { readonly key: string; readonly boxes: readonly Bounds[] };
}
