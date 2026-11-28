import type { PageSize } from './layout';

export interface Point { x: number; y: number }
export interface Box extends Point, PageSize {}
export type Matrix = readonly [number, number, number, number, number, number];
export type Font = 'lato' | 'crimson' | 'plex' | 'pacifico' | 'vibes';
export type Alignment = 'left' | 'center' | 'right';
export type FormValue = string | boolean | string[] | null;
export interface FormWidget {
  id: string;
  name: string;
  kind: 'text' | 'checkbox' | 'radio' | 'dropdown';
  box: Box;
  value: FormValue;
  options: string[];
  readOnly: boolean;
  multiline?: boolean;
  maxLength?: number;
  multiple?: boolean;
}

interface ObjectBase { id: string; box: Box; turn?: number }
export interface TextOverlay extends ObjectBase {
  kind: 'text' | 'typed-signature'; text: string; font: Font; size: number; color: string; bold: boolean; align: Alignment;
}
export type Overlay =
  | TextOverlay
  | (ObjectBase & { kind: 'image' | 'image-signature'; image: Blob })
  | (ObjectBase & { kind: 'highlight' | 'underline' | 'strike'; color: string })
  | (ObjectBase & { kind: 'pen' | 'drawn-signature' | 'line' | 'arrow'; paths: Point[][]; color: string; thickness: number })
  | (ObjectBase & { kind: 'rectangle' | 'ellipse'; color: string; fill?: string; thickness: number })
  | (ObjectBase & { kind: 'whiteout' })
  | (ObjectBase & { kind: 'redaction'; applied: boolean });

export function isAppliedRedaction(object: Overlay): object is Extract<Overlay, { kind: 'redaction' }> {
  return object.kind === 'redaction' && object.applied;
}

export const fontFaces: Record<Font, { label: string; regular: string; bold?: string }> = {
  lato: { label: 'Lato', regular: 'Lato-Regular.ttf', bold: 'Lato-Bold.ttf' },
  crimson: { label: 'Crimson Text', regular: 'CrimsonText-Regular.ttf', bold: 'CrimsonText-Bold.ttf' },
  plex: { label: 'IBM Plex Mono', regular: 'IBMPlexMono-Regular.ttf', bold: 'IBMPlexMono-Bold.ttf' },
  pacifico: { label: 'Pacifico', regular: 'Pacifico-Regular.ttf' },
  vibes: { label: 'Great Vibes', regular: 'GreatVibes-Regular.ttf' },
};

export const textFonts = ['lato', 'crimson', 'plex'] as const;
export const signatureFonts = ['pacifico', 'vibes'] as const;
export const redactionWarning = "Redacted pages are converted to images; text on those pages won't be selectable.";
export const hasRedactions = (objects: readonly Overlay[] | undefined) =>
  Boolean(objects?.some(isAppliedRedaction));

export function pageTransform([left, bottom, right, top]: readonly number[], rotation: number): Matrix {
  switch ((rotation % 360 + 360) % 360) {
    case 90: return [0, 1, 1, 0, -bottom, -left];
    case 180: return [-1, 0, 0, 1, right, -bottom];
    case 270: return [0, -1, -1, 0, top, right];
    default: return [1, 0, 0, -1, -left, top];
  }
}

export function pdfToView([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function viewToPdf([a, b, c, d, e, f]: Matrix, point: Point,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, view: PageSize): Point {
  const x = (point.x - bounds.left) * view.width / bounds.width - e;
  const y = (point.y - bounds.top) * view.height / bounds.height - f;
  const determinant = a * d - b * c;
  return { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
}

export function boxBetween(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function artFrame({ x, y, width, height }: Box, turn: number) {
  const center = { x: x + width / 2, y: y + height / 2 };
  const size = turn % 180 ? { width: height, height: width } : { width, height };
  return { center, box: { ...size, x: center.x - size.width / 2, y: center.y - size.height / 2 } };
}

export function pathsOverlay<T extends 'line' | 'arrow' | 'pen' | 'drawn-signature'>(
  id: string, kind: T, paths: Point[][], color: string, thickness: number,
) {
  const points = paths.flat();
  const box = { x: Infinity, y: Infinity, width: 0, height: 0 };
  let right = -Infinity;
  let top = -Infinity;
  for (const point of points) {
    box.x = Math.min(box.x, point.x);
    box.y = Math.min(box.y, point.y);
    right = Math.max(right, point.x);
    top = Math.max(top, point.y);
  }
  box.width = Math.max(1, right - box.x);
  box.height = Math.max(1, top - box.y);
  return { id, kind, box, color, thickness,
    paths: paths.map(path => path.map(point => ({ x: (point.x - box.x) / box.width, y: (point.y - box.y) / box.height }))) };
}

export function absolutePaths(object: Extract<Overlay, { paths: Point[][] }>) {
  const { box } = object;
  return object.paths.map(path => path.map(point => ({ x: box.x + point.x * box.width, y: box.y + point.y * box.height })));
}

// Smooth sampled pointer paths with a quadratic curve through segment midpoints.
export function smoothPath(points: Point[]) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const current = points[index];
    const previous = points[index - 1];
    const next = points[index + 1];
    const start = index === 1 ? previous : midpoint(previous, current);
    const end = midpoint(current, next);
    result.push(midpoint(midpoint(start, current), midpoint(current, end)), end);
  }
  return [...result, points[points.length - 1]];
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function arrowHead(start: Point, end: Point, thickness: number): Point[] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.min(Math.hypot(end.x - start.x, end.y - start.y) / 2, Math.max(8, 4 * thickness));
  return [-Math.PI / 6, Math.PI / 6].map(offset => ({
    x: end.x - length * Math.cos(angle + offset), y: end.y - length * Math.sin(angle + offset),
  }));
}

export function textLines(text: string, width: number, measure: (text: string) => number): string[] {
  return text.replaceAll('\t', '    ').split(/\r\n?|\n/).flatMap(paragraph => {
    const lines: string[] = [];
    let line = '';
    for (const word of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      if (line && measure(line + word.trimEnd()) > width) {
        lines.push(line.trimEnd());
        line = '';
      }
      line += word;
    }
    lines.push(line.trimEnd());
    return lines;
  });
}
