import { useEffect, useRef, useState } from 'react';
import type { PageSize } from '../../../lib/tools/pdf/layout';
import {
  boxBetween, pathsOverlay, pdfToView, viewToPdf, type Alignment, type Font, type FormValue, type Matrix, type Overlay, type Point,
} from '../../../lib/tools/pdf/overlay';
import { pageRenderKey, type PageOperation, type PageRef } from '../../../lib/tools/pdf/pages';
import type { PageEditingData } from '../../../lib/workers/pdf/types';

export type Mode = 'select' | 'pan' | 'text' | 'signature' | 'highlight' | 'underline' | 'strike' |
  'pen' | 'eraser' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'stamp' | 'whiteout' | 'redaction' | 'forms';
export type Signature = (Extract<Overlay, { paths: Point[][] }> & { kind: 'drawn-signature' }) |
  (Extract<Overlay, { text: string }> & { kind: 'typed-signature' }) |
  (Extract<Overlay, { image: Blob }> & { kind: 'image-signature' });
export type Placement = Signature | Extract<Overlay, { image: Blob } | { text: string } | { paths: Point[][] }>;

const empty: readonly Overlay[] = [];
const defaultStyle = { font: 'lato' as Font, size: 20, color: '#000000', bold: false, align: 'left' as Alignment };
const markModes = new Set<Mode>(['highlight', 'underline', 'strike']);
interface Frame { size: PageSize; transform: Matrix }

export function usePdfEditor(
  page: PageRef | undefined, active: boolean, locked: boolean,
  commit: (operation: PageOperation, announcement: string) => void,
  inspect: (page: PageRef) => Promise<PageEditingData>,
  loadImage: (file: Blob, removeBackground: boolean) => Promise<{ image: Blob; size: PageSize }>,
) {
  const [mode, setMode] = useState<Mode>('select');
  const [selection, select] = useState<{ page: string; object: string }>();
  const [style, setStyle] = useState(defaultStyle);
  const [thickness, setThickness] = useState(2);
  const [fill, setFill] = useState<string>();
  const [placement, setPlacement] = useState<Placement>();
  const [editingData, setEditingData] = useState<{ key: string; value?: PageEditingData; error?: boolean }>();
  const [focusText, setFocusText] = useState(0);
  const [draftText, setDraftText] = useState<{ id: string; text: string }>();
  const frame = useRef<Frame>(null);
  const currentPage = useRef(page);
  currentPage.current = page;
  const key = page ? pageRenderKey(page) : '';
  useEffect(() => {
    if (!active || !currentPage.current) return;
    let live = true;
    const ref = currentPage.current;
    void inspect(ref).then(value => {
      if (live) setEditingData({ key, value });
    }, () => {
      if (live) setEditingData({ key, error: true });
    });
    return () => { live = false; };
  }, [key, active, inspect]);

  const objects = page?.objects ?? empty;
  const selected = page && selection?.page === page.id ? objects.find(object => object.id === selection.object) : undefined;
  const data = editingData?.key === key ? editingData : undefined;

  function replace(object: Overlay, message = 'Updated object.') {
    const existing = objects.find(item => item.id === object.id);
    let next = object;
    if (object.kind === 'redaction' && frame.current) {
      const { size, transform } = frame.current;
      const bounds = { left: 0, top: 0, ...size };
      const limit = boxBetween(viewToPdf(transform, { x: 0, y: 0 }, bounds, size),
        viewToPdf(transform, { x: size.width, y: size.height }, bounds, size));
      const width = Math.min(object.box.width, limit.width);
      const height = Math.min(object.box.height, limit.height);
      const box = { width, height, x: Math.min(limit.x + limit.width - width, Math.max(limit.x, object.box.x)),
        y: Math.min(limit.y + limit.height - height, Math.max(limit.y, object.box.y)) };
      next = { ...object, box, applied: object.applied && (!existing || existing.box === object.box) };
    }
    update(existing ? objects.map(item => item.id === next.id ? next : item) : [...objects, next], message);
  }

  function update(next: readonly Overlay[], message: string) {
    if (page && active && !locked) commit({ kind: 'overlay', id: page.id, objects: next }, message);
  }

  function choose(object?: Overlay) {
    select(object && page ? { page: page.id, object: object.id } : undefined);
  }

  function setTool(next: Mode) {
    if (next !== 'select' && next !== 'pan') choose();
    setMode(next);
  }

  function add(object: Overlay, typing = false) {
    replace(object, 'Added object.');
    choose(object);
    if (mode === 'text' || mode === 'signature' || mode === 'stamp') setMode('select');
    if (typing) setFocusText(value => value + 1);
  }

  function place(point?: Point) {
    if (!frame.current || !page) return;
    const { size, transform } = frame.current;
    const bounds = { left: 0, top: 0, width: size.width, height: size.height };
    const start = point ? pdfToView(transform, point) : { x: size.width / 3, y: size.height / 3 };
    const unit = Math.hypot(transform[0], transform[1]);
    const turn = Math.round(Math.atan2(transform[1], transform[0]) * 180 / Math.PI);
    function position(width: number, height: number) {
      const w = Math.min(size.width, width * unit);
      const h = Math.min(size.height, height * unit);
      const x = Math.max(0, Math.min(start.x, size.width - w));
      const y = Math.max(0, Math.min(start.y, size.height - h));
      return boxBetween(viewToPdf(transform, { x, y }, bounds, size), viewToPdf(transform, { x: x + w, y: y + h }, bounds, size));
    }
    const id = crypto.randomUUID();
    if (mode === 'text') {
      add({ id, kind: 'text', text: '', ...style, turn, box: position(220, Math.max(68, style.size * 3)) }, true);
    } else if ((mode === 'signature' || mode === 'stamp') && placement) {
      const scale = Math.min(190 / placement.box.width, 80 / placement.box.height,
        size.width / unit / placement.box.width, size.height / unit / placement.box.height);
      add({ ...placement, id, turn, box: position(placement.box.width * scale, placement.box.height * scale) });
    } else if (!point) {
      const color = style.color;
      const box = position(100, markModes.has(mode) ? 15 : 50);
      switch (mode) {
        case 'rectangle':
        case 'ellipse': add({ id, kind: mode, box, color, fill, thickness }); break;
        case 'line':
        case 'arrow':
        case 'pen': add(pathsOverlay(id, mode, [[{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }]], color, thickness)); break;
        case 'highlight':
        case 'underline':
        case 'strike': add({ id, kind: mode, box, color }); break;
        case 'whiteout': add({ id, kind: mode, box }); break;
        case 'redaction': add({ id, kind: mode, box, applied: false }); break;
      }
    }
  }

  function remove() {
    if (!selected) return;
    update(objects.filter(object => object.id !== selected.id), 'Deleted object.');
    choose();
  }

  function duplicate() {
    if (!selected) return;
    const copy = { ...selected, id: crypto.randomUUID(), box: { ...selected.box, x: selected.box.x + 8, y: selected.box.y - 8 } };
    if (copy.kind === 'redaction') copy.applied = false;
    add(copy);
  }

  function layer(offset: number) {
    if (!selected) return;
    const index = objects.indexOf(selected);
    if (!objects[index + offset]) return;
    const next = [...objects];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next, offset > 0 ? 'Brought object forward.' : 'Sent object backward.');
  }

  function keyboard(event: KeyboardEvent) {
    if (!active || locked) return false;
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      choose();
      return true;
    }
    if (event.ctrlKey || event.metaKey) {
      if (key === 'd') { duplicate(); return true; }
      return key === 'a';
    }
    if (key === 'delete' || key === 'backspace') {
      if (!event.repeat) remove();
      return true;
    }
    if (key === 'r') return true;
    if (!selected || !frame.current || !key.startsWith('arrow')) return false;
    const [a, b, c, d] = frame.current.transform;
    const step = event.shiftKey ? 10 : 1;
    const direction = { arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] }[key];
    if (!direction) return false;
    const [x, y] = direction;
    const scale = Math.hypot(a, b);
    replace({ ...selected, box: { ...selected.box, x: selected.box.x + (a * x + b * y) * step / scale,
      y: selected.box.y + (c * x + d * y) * step / scale } }, 'Moved object.');
    return true;
  }

  function fillField(name: string, value: FormValue) {
    if (page && !locked) commit({ kind: 'form', id: page.id, name, value }, 'Updated PDF form field.');
  }

  return { active, locked, mode, setTool, style, setStyle, thickness, setThickness, fill, setFill,
    placement, setPlacement, page, frame, focusText, draftText, setDraftText, data, loadImage, selected, objects, choose, add, replace,
    update, place, remove, duplicate, layer, keyboard, fillField, markMode: markModes.has(mode) };
}

export type PdfEditor = ReturnType<typeof usePdfEditor>;
