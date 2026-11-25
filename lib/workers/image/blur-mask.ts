import { isBlurStroke, type BlurOptions, type BlurPoint } from '../../tools/image/blur-options';
import type { Size } from '../../tools/image/geometry';

export function rasterizeBlurMask({ width, height }: Size, { regions, inverted }: BlurOptions) {
  const bits = new Uint8Array(regions.length ? Math.ceil(width * height / 8) : 0);
  let left = inverted ? 0 : width;
  let top = inverted ? 0 : height;
  let right = inverted ? width : 0;
  let bottom = inverted ? height : 0;

  function span(y: number, from: number, to: number, erase: boolean) {
    const first = Math.max(0, Math.ceil(from - 0.5));
    const end = Math.min(width, Math.floor(to - 0.5) + 1);
    if (first >= end) return;
    if (!erase) {
      left = Math.min(left, first);
      right = Math.max(right, end);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
    let start = y * width + first;
    const stop = y * width + end;
    const paint = (index: number) => {
      const bit = 1 << (index & 7);
      if (erase) bits[index >>> 3] &= ~bit;
      else bits[index >>> 3] |= bit;
    };
    while (start < stop && (start & 7)) paint(start++);
    const bulkEnd = stop & ~7;
    if (start < bulkEnd) {
      bits.fill(erase ? 0 : 255, start >>> 3, bulkEnd >>> 3);
      start = bulkEnd;
    }
    while (start < stop) paint(start++);
  }

  function rows(from: number, to: number, draw: (y: number, center: number) => void) {
    const first = Math.max(0, Math.ceil(from - 0.5));
    const last = Math.min(height - 1, Math.floor(to - 0.5));
    for (let y = first; y <= last; y++) draw(y, y + 0.5);
  }

  function capsule(start: BlurPoint, end: BlurPoint, radius: number, erase: boolean) {
    const ax = start.x * width;
    const ay = start.y * height;
    const bx = end.x * width;
    const by = end.y * height;
    const length = Math.hypot(bx - ax, by - ay);
    const nx = length ? -(by - ay) * radius / length : 0;
    const ny = length ? (bx - ax) * radius / length : 0;
    const corners = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];

    rows(Math.min(ay, by) - radius, Math.max(ay, by) + radius, (y, center) => {
      let first = Infinity;
      let last = -Infinity;
      const a = radius ** 2 - (center - ay) ** 2;
      const b = radius ** 2 - (center - by) ** 2;
      if (a >= 0) {
        const half = Math.sqrt(a);
        first = ax - half;
        last = ax + half;
      }
      if (b >= 0) {
        const half = Math.sqrt(b);
        first = Math.min(first, bx - half);
        last = Math.max(last, bx + half);
      }
      for (let i = 0; i < corners.length; i++) {
        const [x1, y1] = corners[i];
        const [x2, y2] = corners[(i + 1) % corners.length];
        if (y1 === y2 || center < Math.min(y1, y2) || center > Math.max(y1, y2)) continue;
        const x = x1 + (x2 - x1) * (center - y1) / (y2 - y1);
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
      span(y, first, last, erase);
    });
  }

  for (const region of regions) {
    if (isBlurStroke(region)) {
      const radius = Math.max(0.5, region.diameter * Math.min(width, height) / 2);
      const erase = region.kind === 'eraser';
      for (let i = 0; i < region.points.length; i++) {
        capsule(region.points[Math.max(0, i - 1)], region.points[i], radius, erase);
      }
      continue;
    }

    const x1 = region.bounds.left * width;
    const x2 = region.bounds.right * width;
    const y1 = region.bounds.top * height;
    const y2 = region.bounds.bottom * height;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const rx = (x2 - x1) / 2;
    const ry = (y2 - y1) / 2;
    rows(y1, y2, (y, center) => {
      const half = region.kind === 'rectangle' ? rx : rx * Math.sqrt(Math.max(0, 1 - ((center - midY) / ry) ** 2));
      span(y, midX - half, midX + half, false);
    });
  }

  return { bits, inverted, left, top, right, bottom };
}

export type BlurMask = ReturnType<typeof rasterizeBlurMask>;
