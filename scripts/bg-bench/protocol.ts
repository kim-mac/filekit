import models from './models.json';

export type Model = (typeof models)[number];
export type Backend = 'wasm' | 'webgpu';
export type Fixture = { id: string; image: string; mask?: string; refine?: boolean };
export type Scores = { iou: number; boundaryF: number };
export type Variant = { mask: Blob; row: Blob; scores: Scores | null };

export type BenchWorker = {
  load(model: Model, backend: Backend, requireHardware?: boolean): Promise<{
    weightsMs: number;
    sessionMs: number;
    loadMs: number;
    adapter: { vendor: string; architecture: string; device: string; description: string; software: boolean } | null;
  }>;
  predict(
    image: ArrayBuffer, truth: ArrayBuffer | null, label: string, repeats: number, refine: boolean,
  ): Promise<{
    timingsMs: number[];
    baseline: Variant;
    guided: Variant | null;
    decontaminatedRow: Blob | null;
    refinementMs: { guided: number; decontamination: number } | null;
  }>;
  compare(image: ArrayBuffer, truth: ArrayBuffer | null, label: string,
    alpha: ArrayBuffer, width: number, height: number): Promise<Variant>;
  close(): Promise<void>;
};
