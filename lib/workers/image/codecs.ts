import { outputFormats, type ResolvedOutput } from '../../tools/image/formats';
import { isOrientation } from '../../tools/image/geometry';
import { detectFormat, firstWebpFrame, hasContainerOrientation } from './headers';
import { imageDetails, pngProfile, readImageTags } from './metadata';
import { flatten, hasTransparency, orient } from './pixels';

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

export async function decodeImage(original: Blob, normalize = true, includeDetails = false) {
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

  const tags = includeDetails || (!containerOriented && format !== 'gif') ? await readImageTags(buffer, includeDetails) : {};
  const tag = !containerOriented && format !== 'gif' ? tags.exif?.Orientation?.value : 1;
  const orientation = isOrientation(tag) ? tag : 1;
  const details = includeDetails ? imageDetails(format, tags, hasTransparency(frame), format === 'png' ? pngProfile(buffer) : undefined) : undefined;
  return { frame: normalize ? orient(frame, orientation) : frame, format, orientation, details };
}

export async function encodeImage(frame: ImageData, options: ResolvedOutput): Promise<Blob> {
  const { format, quality, background } = options;
  let bytes: ArrayBuffer;
  switch (format) {
    case 'jpeg': {
      const { default: encode } = await import('@jsquash/jpeg/encode.js');
      bytes = await encode(flatten(frame, background), { quality });
      break;
    }
    case 'png': {
      const [{ init }, { encode }] = await Promise.all([
        import('@jsquash/png/encode.js'),
        import('@jsquash/png/codec/pkg/squoosh_png.js'),
      ]);
      await init();
      // The convenience encoder ignores byteOffset and byteLength.
      const { data } = frame;
      const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      bytes = encode(pixels, frame.width, frame.height, 8).buffer as ArrayBuffer;
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
    case 'bmp':
    case 'gif':
    case 'tiff':
    case 'ico': {
      const { encodeExtended } = await import('./extended-codecs');
      return encodeExtended(format === 'bmp' ? flatten(frame, background) : frame, { ...options, format });
    }
  }
  return new Blob([bytes], { type: outputFormats[format].mime });
}
