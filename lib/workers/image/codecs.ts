import { outputFormats, type ConvertOptions } from '../../tools/image/formats';
import { detectFormat, firstWebpFrame, hasContainerOrientation } from './headers';
import { flatten, orient } from './pixels';

const decoders = {
  jpeg: () => import('@jsquash/jpeg/decode.js'),
  png: () => import('@jsquash/png/decode.js'),
  webp: () => import('@jsquash/webp/decode.js'),
  avif: () => import('@jsquash/avif/decode.js'),
  gif: () => import('@discourse/gif/decode.js'),
};

async function decodeWebp(buffer: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await decoders.webp();
  const first = firstWebpFrame(buffer);
  if (!first) return decode(buffer);

  const frame = await decode(first.buffer);
  if (frame.width === first.width && frame.height === first.height) return frame;
  const canvas = new ImageData(first.width, first.height);
  for (let row = 0; row < frame.height; row++) {
    const start = row * frame.width * 4;
    canvas.data.set(frame.data.subarray(start, start + frame.width * 4), ((row + first.y) * first.width + first.x) * 4);
  }
  return canvas;
}

async function readOrientation(input: ArrayBuffer): Promise<number> {
  try {
    const { load } = await import('exifreader');
    const { exif } = load(input, { expanded: true, includeTags: { exif: ['Orientation'] } });
    return exif?.Orientation?.value ?? 1;
  } catch {
    // Unreadable metadata can coexist with valid image pixels.
    return 1;
  }
}

export async function decodeImage(original: Blob) {
  const buffer = await original.arrayBuffer();
  const format = detectFormat(buffer);
  const containerOriented = (format === 'heic' || format === 'avif') && hasContainerOrientation(buffer);
  let frame: ImageData | null;
  if (format === 'heic' || containerOriented) {
    const { decodeHeif } = await import('./heif');
    frame = await decodeHeif(buffer);
  } else if (format === 'webp') {
    frame = await decodeWebp(buffer);
  } else {
    const { default: decode } = await decoders[format]();
    frame = await decode(buffer);
  }
  if (!frame) throw new Error('The decoder returned no image.');

  if (!containerOriented && format !== 'gif') {
    frame = orient(frame, await readOrientation(buffer));
  }
  return { frame, format };
}

export async function encodeImage(frame: ImageData, options: ConvertOptions): Promise<Blob> {
  const { format, quality, background } = options;
  let bytes: ArrayBuffer;
  switch (format) {
    case 'jpeg': {
      const { default: encode } = await import('@jsquash/jpeg/encode.js');
      bytes = await encode(flatten(frame, background), { quality });
      break;
    }
    case 'png': {
      const { default: encode } = await import('@jsquash/png/encode.js');
      bytes = await encode(frame);
      break;
    }
    case 'webp': {
      const { default: encode } = await import('@jsquash/webp/encode.js');
      bytes = await encode(frame, { quality, low_memory: 1 });
      break;
    }
    case 'avif': {
      const { default: encode } = await import('@jsquash/avif/encode.js');
      bytes = await encode(frame, { quality, qualityAlpha: 100 });
      break;
    }
  }
  return new Blob([bytes], { type: outputFormats[format].mime });
}
