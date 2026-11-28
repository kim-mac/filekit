export interface PageSize {
  width: number;
  height: number;
}

export interface ImageLayout {
  size: 'fit' | 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
}

export const defaultImageLayout: ImageLayout = { size: 'fit', orientation: 'auto', margin: 0 };
export const a4: PageSize = { width: 595.28, height: 841.89 };
export const letter: PageSize = { width: 612, height: 792 };
export const mobileRasterPixels = 16_000_000;
const desktopRasterPixels = 64_000_000;

export function imagePlacement(imageWidth: number, imageHeight: number, { size, orientation, margin }: ImageLayout) {
  const paper = size === 'fit' ? { width: imageWidth + 2 * margin, height: imageHeight + 2 * margin }
    : size === 'a4' ? a4 : letter;
  const landscape = orientation === 'auto' ? imageWidth > imageHeight : orientation === 'landscape';
  const { width, height } = (paper.width > paper.height) === landscape
    ? paper : { width: paper.height, height: paper.width };
  const scale = Math.min((width - 2 * margin) / imageWidth, (height - 2 * margin) / imageHeight);
  return { width, height, imageWidth: imageWidth * scale, imageHeight: imageHeight * scale };
}

export function rotatedSize({ width, height }: PageSize, rotation: number): PageSize {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

export function pixelDimensions({ width, height }: PageSize, dpi: number, mobile: boolean) {
  const cap = mobile ? mobileRasterPixels : desktopRasterPixels;
  const requested = dpi / 72;
  const limit = Math.min(Math.sqrt(cap / (width * height)), (mobile ? 8192 : 16380) / Math.max(width, height));
  const scale = mobile ? Math.min(requested, limit) : requested;
  if (!Number.isFinite(scale) || scale <= 0 || (!mobile && requested > limit)) {
    throw new Error('This page is too large at the selected DPI. Choose a lower DPI.');
  }
  const limited = scale < requested;
  const round = limited ? Math.floor : Math.round;
  const dimensions = { width: Math.max(1, round(width * scale)), height: Math.max(1, round(height * scale)) };
  if (dimensions.width * dimensions.height > cap || dimensions.width > 16380 || dimensions.height > 16380) {
    throw new Error('This page is too large at the selected DPI. Choose a lower DPI.');
  }
  return { ...dimensions, scale, limited };
}

export function parseRanges(value: string, count: number): number[][] {
  return value.split(',').map(part => {
    const match = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part);
    const start = Number(match?.[1]);
    const end = Number(match?.[2] ?? start);
    if (!match || start < 1 || end < start || end > count) {
      throw new Error(`Enter ranges between 1 and ${count}, for example 1-3, 5.`);
    }
    return Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset);
  });
}

export function splitGroups(count: number, every: number): number[][] {
  if (!Number.isSafeInteger(every) || every < 1) throw new Error('Enter a whole number greater than zero.');
  return Array.from({ length: Math.ceil(count / every) }, (_, group) => {
    const start = group * every;
    return Array.from({ length: Math.min(every, count - start) }, (_, offset) => start + offset);
  });
}
