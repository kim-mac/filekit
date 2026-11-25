import type { HeifImage, HeifModule } from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

let modulePromise: Promise<HeifModule> | undefined;

export async function decodeHeif(buffer: ArrayBuffer): Promise<ImageData> {
  const heif = await (modulePromise ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs')
    .then(({ default: initialize }) => initialize()));
  const decoder = new heif.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(new Uint8Array(buffer));
    const primary = images.find((image) => image.is_primary()) ?? images[0];
    if (!primary) throw new Error('No image in the HEIF container.');
    const target = new ImageData(primary.get_width(), primary.get_height());
    const result = await new Promise<ImageData | null>((resolve) => primary.display(target, resolve));
    if (!result) throw new Error('Could not decode the HEIF frame.');
    return result;
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) heif.heif_context_free(decoder.decoder);
  }
}
