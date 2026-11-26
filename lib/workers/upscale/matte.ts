import type { BackgroundOptions } from '../../tools/image/background-options';
import {
  combineOrientations, fullBounds, orientBounds, orientedSize, orientationMatrix,
  type Bounds, type ImageGeometry, type Orientation, type Size,
} from '../../tools/image/geometry';

export interface SourceMapping {
  readonly bounds: Bounds;
  readonly orientation: Orientation;
}

export const sourceMapping: SourceMapping = { bounds: fullBounds, orientation: 1 };

function inverse(orientation: Orientation): Orientation {
  return orientation === 6 ? 8 : orientation === 8 ? 6 : orientation;
}

export function mapSource(mapping: SourceMapping, frame: Size, geometry: ImageGeometry): SourceMapping {
  const { left, top, right, bottom } = geometry.bounds;
  const crop = orientBounds({
    left: left / frame.width, right: right / frame.width,
    top: top / frame.height, bottom: bottom / frame.height,
  }, inverse(mapping.orientation));
  const source = mapping.bounds;
  const width = source.right - source.left;
  const height = source.bottom - source.top;
  return {
    bounds: {
      left: source.left + crop.left * width, right: source.left + crop.right * width,
      top: source.top + crop.top * height, bottom: source.top + crop.bottom * height,
    },
    orientation: combineOrientations(mapping.orientation, geometry.orientation),
  };
}

export async function projectMatte(edit: BackgroundOptions, mapping: SourceMapping): Promise<BackgroundOptions> {
  const mask = edit.mask;
  const { left, top, right, bottom } = mapping.bounds;
  if (!mask || (mapping.orientation === 1 && left === 0 && top === 0 && right === 1 && bottom === 1)) return edit;
  const { width, height } = orientedSize({
    width: Math.max(1, Math.round(mask.width * (right - left))),
    height: Math.max(1, Math.round(mask.height * (bottom - top))),
  }, mapping.orientation);
  const input = new Uint8Array(await mask.alpha.arrayBuffer());
  const alpha = new Uint8Array(width * height);
  const [a, b, c, d] = orientationMatrix[inverse(mapping.orientation)];
  for (let row = 0; row < height; row++) {
    const y = (row + 0.5) / height - 0.5;
    for (let col = 0; col < width; col++) {
      const x = (col + 0.5) / width - 0.5;
      const sx = mask.width * (left + (right - left) * (a * x + c * y + 0.5)) - 0.5;
      const sy = mask.height * (top + (bottom - top) * (b * x + d * y + 0.5)) - 0.5;
      const mx = Math.max(0, Math.min(mask.width - 1, sx));
      const my = Math.max(0, Math.min(mask.height - 1, sy));
      const x0 = Math.floor(mx);
      const y0 = Math.floor(my);
      const x1 = Math.min(mask.width - 1, x0 + 1);
      const y1 = Math.min(mask.height - 1, y0 + 1);
      const dx = mx - x0;
      const dy = my - y0;
      const first = input[y0 * mask.width + x0] * (1 - dx) + input[y0 * mask.width + x1] * dx;
      const second = input[y1 * mask.width + x0] * (1 - dx) + input[y1 * mask.width + x1] * dx;
      alpha[row * width + col] = Math.round(first * (1 - dy) + second * dy);
    }
  }
  return { ...edit, mask: { ...mask, width, height, alpha: new Blob([alpha]) } };
}
