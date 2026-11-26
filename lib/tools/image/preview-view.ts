import type { Size } from './geometry';

export interface Point { readonly x: number; readonly y: number }
export interface View extends Point { readonly scale: number }

export const fitView: View = { scale: 1, x: 0, y: 0 };

export function fitScale(image: Size, viewport: Size) {
  return Math.min(viewport.width / image.width, viewport.height / image.height);
}

// Coordinates are relative to the center of the canvas. Keep the same
// image point under the pointer, even when the pinch midpoint moves.
export function zoomAt(view: View, scale: number, from: Point, to = from): View {
  const ratio = scale / view.scale;
  return { scale, x: to.x + (view.x - from.x) * ratio, y: to.y + (view.y - from.y) * ratio };
}

export function framePoint(point: Point, frame: { left: number; top: number; width: number; height: number }): Point {
  return { x: (point.x - frame.left) / frame.width, y: (point.y - frame.top) / frame.height };
}
