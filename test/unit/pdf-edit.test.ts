import { describe, expect, it } from 'vitest';
import { pageTransform, pdfToView, viewToPdf, type Overlay } from '../../lib/tools/pdf/overlay';
import { applyPageOperation, pdfPages, replayPages } from '../../lib/tools/pdf/pages';

describe('PDF edit geometry', () => {
  it.each([
    [0, [0, 300]], [90, [0, 0]], [180, [200, 0]], [270, [300, 200]],
  ])('maps cropped PDF coordinates through %d° and viewport zoom', (rotation, corner) => {
    const matrix = pageTransform([20, -10, 220, 290], rotation);
    expect(Object.values(pdfToView(matrix, { x: 20, y: -10 }))).toEqual(corner);
    const bounds = { left: 110, top: 85, width: rotation % 180 ? 750 : 500, height: rotation % 180 ? 500 : 750 };
    const target = pdfToView(matrix, { x: 70, y: 190 });
    expect(viewToPdf(matrix, { x: bounds.left + target.x * 2.5, y: bounds.top + target.y * 2.5 }, bounds,
      { width: bounds.width / 2.5, height: bounds.height / 2.5 })).toEqual({ x: 70, y: 190 });
  });

  it('replays overlays on their page through move, rotate, copy, and delete', () => {
    const initial = pdfPages('original', 2);
    const [first, second] = initial;
    const object: Overlay = { id: 'cover', kind: 'whiteout', box: { x: 10, y: 20, width: 30, height: 40 } };
    const edited = replayPages(initial, [
      { toolId: 'edit', options: { kind: 'overlay', id: first.id, objects: [object] } },
      { toolId: 'organize', options: { kind: 'move', ids: [first.id], target: second.id, after: true } },
      { toolId: 'organize', options: { kind: 'rotate', ids: [first.id], clockwise: 90 } },
      { toolId: 'organize', options: { kind: 'duplicate', ids: [first.id], newIds: ['copy'] } },
      { toolId: 'organize', options: { kind: 'delete', ids: [first.id] } },
    ]);
    expect(edited.map(page => page.id)).toEqual([second.id, 'copy']);
    expect(edited[1]).toMatchObject({ rotation: 90, objects: [object] });
    expect(applyPageOperation(initial, { kind: 'insert', pages: [{ ...edited[1], id: 'merged' }] }).at(-1)?.objects).toEqual([object]);
    expect(initial[0].objects).toBeUndefined();
  });
});
