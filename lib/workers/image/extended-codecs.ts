import {
  Gravity, ImageMagick, MagickColors, MagickFormat, MagickGeometry, MagickReadSettings, initializeImageMagick,
} from '@imagemagick/magick-wasm';
import { iconSizes, outputFormats, type ResolvedOutput } from '../../tools/image/formats';

let ready: Promise<void> | undefined;

export function initializeExtendedCodecs(wasm?: Uint8Array<ArrayBuffer>) {
  return ready ??= initializeImageMagick(wasm ?? new URL('/workers/magick.wasm', location.origin))
    .catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
}

const formats = { bmp: MagickFormat.Bmp3, gif: MagickFormat.Gif, tiff: MagickFormat.Tiff };

export async function encodeExtended(frame: ImageData, options: ResolvedOutput & { format: 'bmp' | 'gif' | 'tiff' | 'ico' }) {
  await initializeExtendedCodecs();
  const { width, height, data } = frame;
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const settings = new MagickReadSettings({ width, height, depth: 8, format: MagickFormat.Rgba });

  if (options.format === 'ico') {
    const sizes = options.iconSizes ?? iconSizes;
    const images = ImageMagick.read(pixels, settings, source => sizes.map(size => source.clone(image => {
      image.resize(new MagickGeometry(size, size));
      image.extent(new MagickGeometry(size, size), Gravity.Center, MagickColors.Transparent);
      return image.write(MagickFormat.Png32, bytes => new Uint8Array(bytes));
    })));

    // ICO stores a directory followed by one image for each selected size.
    const directory = new DataView(new ArrayBuffer(6 + sizes.length * 16));
    directory.setUint16(2, 1, true);
    directory.setUint16(4, sizes.length, true);
    let offset = directory.byteLength;
    for (const [index, size] of sizes.entries()) {
      const entry = 6 + index * 16;
      directory.setUint8(entry, size % 256);
      directory.setUint8(entry + 1, size % 256);
      directory.setUint16(entry + 4, 1, true);
      directory.setUint16(entry + 6, 32, true);
      directory.setUint32(entry + 8, images[index].byteLength, true);
      directory.setUint32(entry + 12, offset, true);
      offset += images[index].byteLength;
    }
    return new Blob([directory.buffer, ...images], { type: outputFormats.ico.mime });
  }

  const format = formats[options.format];
  return ImageMagick.read(pixels, settings, image => image.write(format, bytes =>
    new Blob([new Uint8Array(bytes)], { type: outputFormats[options.format].mime }),
  ));
}
