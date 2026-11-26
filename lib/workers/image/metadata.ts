import type { ExpandedTags, IncludeTagsOptions } from 'exifreader';
import type { InputFormat } from '../../tools/image/formats';

export interface ImageDetails {
  readonly colorMode?: string;
  readonly bitDepth?: number;
  readonly cameraMake?: string;
  readonly cameraModel?: string;
  readonly taken?: string;
  readonly profile?: string;
  readonly hasLocation: boolean;
  readonly transparent: boolean;
}

const detailTags: IncludeTagsOptions = {
  exif: ['Orientation', 'Make', 'Model', 'DateTimeOriginal', 'DateTimeDigitized', 'OffsetTimeOriginal',
    'ColorSpace', 'GPSLatitude', 'GPSLongitude'],
  file: ['Bits Per Sample', 'Color Components'],
  png: ['Bit Depth', 'Color Type'],
  gif: ['Bits Per Pixel', 'Global Color Map'],
  icc: ['ICC Description', 'ICC Device Model Description', 'Color Space', 'Profile Version'],
  gps: ['Latitude', 'Longitude'],
  xmp: ['Make', 'Model', 'DateTimeOriginal', 'GPSLatitude', 'GPSLongitude'],
};

export async function readImageTags(input: ArrayBuffer, details: boolean): Promise<ExpandedTags> {
  try {
    const { load } = await import('exifreader');
    return details
      ? await load(input, { expanded: true, async: true, includeTags: detailTags, excludeTags: { xmp: ['_raw'] } })
      : load(input, { expanded: true, includeTags: { exif: ['Orientation'] } });
  } catch {
    // Unreadable metadata can coexist with valid image pixels.
    return {};
  }
}

function text(value: unknown) {
  if (typeof value !== 'string') return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || undefined;
}

export function pngProfile(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  for (let offset = 8; offset + 12 <= view.byteLength;) {
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (type === 0x49444154 || length > view.byteLength - offset - 12) return;
    if (type === 0x73524742 && length === 1) return 'sRGB';
    offset += length + 12;
  }
}

export function imageDetails(format: InputFormat, tags: ExpandedTags, transparent: boolean, containerProfile?: string): ImageDetails {
  const { exif, file, gif, gps, icc, png, xmp } = tags;
  const components = file?.['Color Components']?.value;
  const heif = format === 'avif' || format === 'heic';
  const profile = text(icc?.['ICC Description']?.description) ?? text(icc?.['ICC Device Model Description']?.description) ??
    (icc?.['Profile Version'] ? 'Embedded ICC profile' : containerProfile ?? (exif?.ColorSpace?.value === 1 ? 'sRGB' : undefined));
  const date = text(exif?.DateTimeOriginal?.description ?? xmp?.DateTimeOriginal?.description ?? exif?.DateTimeDigitized?.description);
  const offset = text(exif?.OffsetTimeOriginal?.description);
  return {
    transparent,
    colorMode: png?.['Color Type']?.description ??
      (format === 'gif' ? 'Indexed color' : format === 'webp' ? 'RGB' :
        components === 1 || (heif && components === 2) ? 'Grayscale' :
          components === 3 || (heif && components === 4) ? 'RGB' :
            format === 'jpeg' && components === 4 ? 'CMYK' : undefined),
    bitDepth: png?.['Bit Depth']?.value ?? file?.['Bits Per Sample']?.value ??
      (format === 'webp' ? 8 : format === 'gif' && gif?.['Global Color Map']?.value ? gif['Bits Per Pixel']?.value : undefined),
    cameraMake: text(exif?.Make?.description ?? xmp?.Make?.description),
    cameraModel: text(exif?.Model?.description ?? xmp?.Model?.description),
    taken: date ? date.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') + (offset ? ` ${offset}` : '') : undefined,
    profile,
    hasLocation: Boolean(exif?.GPSLatitude || exif?.GPSLongitude || xmp?.GPSLatitude || xmp?.GPSLongitude ||
      gps?.Latitude !== undefined || gps?.Longitude !== undefined),
  };
}
