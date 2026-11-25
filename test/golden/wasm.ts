import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { vi } from 'vitest';

const resolve = createRequire(import.meta.url).resolve;

export async function readWasm(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await readFile(resolve(path)));
}

export async function initializeWasm() {
  vi.stubGlobal('ImageData', class {
    readonly data: Uint8ClampedArray<ArrayBuffer>;
    readonly width: number;
    readonly height: number;
    constructor(data: Uint8ClampedArray<ArrayBuffer> | number, width: number, height?: number) {
      this.data = typeof data === 'number' ? new Uint8ClampedArray(data * width * 4) : data;
      this.width = typeof data === 'number' ? data : width;
      this.height = typeof data === 'number' ? width : height ?? this.data.length / (width * 4);
    }
  });

  // The production codec modules fetch their own assets. Seed those same
  // modules from the installed packages so these tests run without HTTP.
  await Promise.all([
    import('@jsquash/jpeg/decode.js').then(async ({ init }) => init({
      wasmBinary: await readWasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
    })),
    import('@jsquash/jpeg/encode.js').then(async ({ init }) => init({
      wasmBinary: await readWasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'),
    })),
    import('@jsquash/png/decode.js').then(async ({ init }) => init(await readWasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))),
    import('@jsquash/png/encode.js').then(async ({ init }) => init(await readWasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))),
    import('@jsquash/webp/decode.js').then(async ({ init }) => init({
      wasmBinary: await readWasm('@jsquash/webp/codec/dec/webp_dec.wasm'),
    })),
    import('@jsquash/webp/encode.js').then(async ({ init }) => init({
      wasmBinary: await readWasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm'),
    })),
    import('@jsquash/avif/decode.js').then(async ({ init }) => init({
      wasmBinary: await readWasm('@jsquash/avif/codec/dec/avif_dec.wasm'),
    })),
    import('@jsquash/avif/encode.js').then(async ({ init }) => init({
      wasmBinary: await readWasm('@jsquash/avif/codec/enc/avif_enc.wasm'),
    })),
    import('@discourse/gif/codec/pkg/squoosh_gif.js').then(async ({ default: init }) => init({ module_or_path: await readWasm('@discourse/gif/codec/pkg/squoosh_gif_bg.wasm') })),
  ]);
}
