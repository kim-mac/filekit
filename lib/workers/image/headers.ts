import type { InputFormat } from '../../tools/image/formats';

function ascii(view: DataView, offset: number, length: number): string {
  if (offset + length > view.byteLength) return '';
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, length));
}

export function detectFormat(buffer: ArrayBuffer): InputFormat {
  const bytes = new DataView(buffer);
  if (bytes.byteLength >= 2 && bytes.getUint16(0) === 0xffd8) return 'jpeg';
  if (bytes.byteLength >= 8 && bytes.getUint32(0) === 0x89504e47 && bytes.getUint32(4) === 0x0d0a1a0a) return 'png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'gif';

  if (ascii(bytes, 4, 4) === 'ftyp' && bytes.byteLength >= 16) {
    const brands = [ascii(bytes, 8, 4)];
    const boxEnd = Math.min(bytes.getUint32(0) || bytes.byteLength, bytes.byteLength);
    for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
      brands.push(ascii(bytes, offset, 4));
    }
    if (brands.some((brand) => ['avif', 'avis'].includes(brand))) return 'avif';
    if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))) return 'heic';
  }
  throw new Error('Unsupported image. Choose a JPG, PNG, WebP, AVIF, GIF, or HEIC file.');
}

function* riffChunks(view: DataView) {
  for (let start = 12; start + 8 <= view.byteLength;) {
    const size = view.getUint32(start + 4, true);
    const end = start + 8 + size;
    if (end > view.byteLength) return;
    yield { type: ascii(view, start, 4), data: start + 8, end };
    start = end + size % 2;
  }
}

// An animated WebP wraps each still bitstream in ANMF. Rewrap its first frame
// as a still WebP so the same decoder can handle it on every browser.
export function firstWebpFrame(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const read24 = (offset: number) => view.getUint16(offset, true) + view.getUint8(offset + 2) * 65536;
  let width = 0;
  let height = 0;
  for (const chunk of riffChunks(view)) {
    const { type, data, end } = chunk;
    if (type === 'VP8X' && end - data >= 10) {
      width = read24(data + 4) + 1;
      height = read24(data + 7) + 1;
    }
    if (type !== 'ANMF') continue;
    if (!width || !height || end - data < 24) throw new Error('Invalid animated WebP.');
    const x = read24(data) * 2;
    const y = read24(data + 3) * 2;
    const frameWidth = read24(data + 6) + 1;
    const frameHeight = read24(data + 9) + 1;
    if (x + frameWidth > width || y + frameHeight > height) throw new Error('Invalid WebP frame bounds.');

    const frame = new Uint8Array(buffer, data + 16, end - data - 16);
    const hasAlphaChunk = ascii(view, data + 16, 4) === 'ALPH';
    // Lossy alpha requires a VP8X header. Lossless VP8L carries its own alpha.
    const headerSize = hasAlphaChunk ? 30 : 12;
    const still = new Uint8Array(headerSize + frame.length);
    still.set(new TextEncoder().encode('RIFF\0\0\0\0WEBP'));
    const header = new DataView(still.buffer);
    header.setUint32(4, still.byteLength - 8, true);
    if (hasAlphaChunk) {
      still.set(new TextEncoder().encode('VP8X'), 12);
      header.setUint32(16, 10, true);
      still[20] = 0x10;
      header.setUint32(24, frameWidth - 1, true);
      header.setUint16(27, (frameHeight - 1) & 0xffff, true);
      still[29] = (frameHeight - 1) >>> 16;
    }
    still.set(frame, headerSize);
    return { buffer: still.buffer, width, height, x, y };
  }
}

function* boxes(view: DataView, start: number, end: number): Generator<{ type: string; start: number; end: number }> {
  while (start + 8 <= end) {
    const length = view.getUint32(start);
    const type = ascii(view, start + 4, 4);
    const header = length === 1 ? 16 : 8;
    if (start + header > end) return;
    const size = length === 1 ? Number(view.getBigUint64(start + 8)) : length || end - start;
    if (size < header || size > end - start) return;
    yield { type, start: start + header, end: start + size };
    start += size;
  }
}

export function hasContainerOrientation(buffer: ArrayBuffer): boolean {
  const view = new DataView(buffer);
  const meta = [...boxes(view, 0, view.byteLength)].find((box) => box.type === 'meta');
  if (!meta) return false;
  const items = [...boxes(view, meta.start + 4, meta.end)];
  const primary = items.find((box) => box.type === 'pitm');
  const properties = items.find((box) => box.type === 'iprp');
  if (!primary || primary.end - primary.start < 6 || !properties) return false;
  const longPrimary = view.getUint8(primary.start) !== 0;
  if (longPrimary && primary.end - primary.start < 8) return false;
  const primaryId = longPrimary ? view.getUint32(primary.start + 4) : view.getUint16(primary.start + 4);

  const propertyBoxes = [...boxes(view, properties.start, properties.end)];
  const container = propertyBoxes.find((box) => box.type === 'ipco');
  if (!container) return false;
  const transformations = [...boxes(view, container.start, container.end)].map(({ type, start, end }) =>
    end > start && (type === 'imir' || (type === 'irot' && (view.getUint8(start) & 3) !== 0)),
  );

  // Properties are 1-indexed. A thumbnail's rotation does not describe the primary image.
  for (const associations of propertyBoxes.filter(({ type }) => type === 'ipma')) {
    const { start, end } = associations;
    if (end - start < 8) continue;
    const idSize = view.getUint8(start) ? 4 : 2;
    const propertySize = view.getUint8(start + 3) & 1 ? 2 : 1;
    const entries = view.getUint32(start + 4);
    let offset = start + 8;
    for (let index = 0; index < entries && offset + idSize < end; index++) {
      const id = idSize === 2 ? view.getUint16(offset) : view.getUint32(offset);
      const count = view.getUint8(offset + idSize);
      offset += idSize + 1;
      if (offset + count * propertySize > end) break;
      for (let property = 0; id === primaryId && property < count; property++) {
        const position = offset + property * propertySize;
        const number = propertySize === 2 ? view.getUint16(position) & 0x7fff : view.getUint8(position) & 0x7f;
        if (transformations[number - 1]) return true;
      }
      offset += count * propertySize;
    }
  }
  return false;
}
