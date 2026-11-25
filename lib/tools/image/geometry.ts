export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const fullBounds: Bounds = { left: 0, top: 0, right: 1, bottom: 1 };

// CSS matrix order, equivalent to the eight EXIF orientations.
export const orientationMatrix = {
  1: [1, 0, 0, 1],
  2: [-1, 0, 0, 1],
  3: [-1, 0, 0, -1],
  4: [1, 0, 0, -1],
  5: [0, 1, 1, 0],
  6: [0, 1, -1, 0],
  7: [0, -1, -1, 0],
  8: [0, -1, 1, 0],
} as const;

export type Orientation = keyof typeof orientationMatrix;
const orientations = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function isOrientation(value: unknown): value is Orientation {
  return orientations.some((orientation) => value === orientation);
}

export function orientedSize({ width, height }: Size, orientation: Orientation): Size {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

export function combineOrientations(first: Orientation, next: Orientation): Orientation {
  const [a, b, c, d] = orientationMatrix[first];
  const [e, f, g, h] = orientationMatrix[next];
  return orientations.find((candidate) => {
    const [x, y, u, v] = orientationMatrix[candidate];
    return x === e * a + g * b && y === f * a + h * b && u === e * c + g * d && v === f * c + h * d;
  })!;
}

export function orientBounds(bounds: Bounds, orientation: Orientation): Bounds {
  const { left, top, right, bottom } = bounds;
  const [a, b, c, d] = orientationMatrix[orientation];
  const axis = (x: number, y: number): [number, number] => {
    if (x === 1) return [left, right];
    if (x === -1) return [1 - right, 1 - left];
    if (y === 1) return [top, bottom];
    return [1 - bottom, 1 - top];
  };
  const [x1, x2] = axis(a, c);
  const [y1, y2] = axis(b, d);
  return { left: x1, top: y1, right: x2, bottom: y2 };
}

export interface ImageGeometry {
  // Integer edges in the original raster, before applying the orientation.
  readonly bounds: Bounds;
  readonly orientation: Orientation;
}

export function fullGeometry({ width, height }: Size, orientation: Orientation = 1): ImageGeometry {
  return { bounds: { left: 0, top: 0, right: width, bottom: height }, orientation };
}

function boundsSize({ left, top, right, bottom }: Bounds): Size {
  return { width: right - left, height: bottom - top };
}

export function geometrySize({ bounds, orientation }: ImageGeometry): Size {
  return orientedSize(boundsSize(bounds), orientation);
}

function pixelBounds(bounds: Bounds, { width, height }: Size): Bounds {
  const left = Math.min(width - 1, Math.round(bounds.left * width));
  const top = Math.min(height - 1, Math.round(bounds.top * height));
  return {
    left, top,
    right: Math.max(left + 1, Math.round(bounds.right * width)),
    bottom: Math.max(top + 1, Math.round(bounds.bottom * height)),
  };
}

function normalizedBounds({ left, top, right, bottom }: Bounds, { width, height }: Size): Bounds {
  return { left: left / width, top: top / height, right: right / width, bottom: bottom / height };
}

export function editGeometry(geometry: ImageGeometry, bounds: Bounds, next: Orientation): ImageGeometry {
  const orientation = combineOrientations(geometry.orientation, next);
  const size = orientedSize(boundsSize(geometry.bounds), orientation);
  const rounded = normalizedBounds(pixelBounds(bounds, size), size);
  // Quarter turns undo each other. Every reflection and half turn is its own inverse.
  const inverse = orientation === 6 ? 8 : orientation === 8 ? 6 : orientation;
  const source = pixelBounds(orientBounds(rounded, inverse), boundsSize(geometry.bounds));
  const { left, top } = geometry.bounds;
  return {
    orientation,
    bounds: { left: left + source.left, top: top + source.top, right: left + source.right, bottom: top + source.bottom },
  };
}

export function scaleGeometry(geometry: ImageGeometry, original: Size, preview: Size): ImageGeometry {
  return { ...geometry, bounds: pixelBounds(normalizedBounds(geometry.bounds, original), preview) };
}

export function sameGeometry(first: ImageGeometry, second: ImageGeometry): boolean {
  const a = first.bounds;
  const b = second.bounds;
  return first.orientation === second.orientation &&
    a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}
