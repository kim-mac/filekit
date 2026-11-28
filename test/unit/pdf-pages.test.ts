import { describe, expect, it } from 'vitest';
import { imagePlacement, parseRanges, pixelDimensions, splitGroups } from '../../lib/tools/pdf/layout';
import { applyPageOperation, pdfPages } from '../../lib/tools/pdf/pages';

describe('PDF page plans', () => {
  it('keeps stable source references across move, rotate, duplicate, delete and insert', () => {
    const original = pdfPages('a', 3);
    const [first, second, third] = original;
    let pages = applyPageOperation(original, { kind: 'move', ids: [first.id], target: third.id, after: true });
    pages = applyPageOperation(pages, { kind: 'rotate', ids: [second.id], clockwise: -90 });
    pages = applyPageOperation(pages, { kind: 'duplicate', ids: [second.id], newIds: ['copy'] });
    pages = applyPageOperation(pages, { kind: 'delete', ids: [third.id] });
    pages = applyPageOperation(pages, { kind: 'insert', after: 'copy', pages: pdfPages('b', 1) });
    expect(pages.map(page => [page.id, page.kind === 'pdf' && page.index, page.rotation])).toEqual([
      [second.id, 1, 270], ['copy', 1, 270], ['b:0', 0, 0], [first.id, 0, 0],
    ]);
    expect(original.map(page => page.rotation)).toEqual([0, 0, 0]);
  });

  it('parses one-based ranges and keeps each split group in the requested order', () => {
    expect(parseRanges('1-3, 5, 8 - 10', 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
    expect(splitGroups(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    for (const input of ['', '0-3', '3-1', '1,', '1–11', '3.5']) {
      expect(() => parseRanges(input, 10)).toThrow();
    }
  });

  it('calculates image margins and PDF raster dimensions in physical units', () => {
    expect(imagePlacement(120, 60, { size: 'fit', orientation: 'auto', margin: 12 })).toEqual({
      width: 144, height: 84, imageWidth: 120, imageHeight: 60,
    });
    expect(imagePlacement(120, 60, { size: 'letter', orientation: 'landscape', margin: 36 })).toEqual({
      width: 792, height: 612, imageWidth: 720, imageHeight: 360,
    });
    expect(pixelDimensions({ width: 612, height: 792 }, 300, false)).toEqual({
      width: 2550, height: 3300, scale: 300 / 72, limited: false,
    });
    expect(pixelDimensions({ width: 2000, height: 2000 }, 300, true)).toMatchObject({
      width: 4000, height: 4000, limited: true,
    });
  });
});
