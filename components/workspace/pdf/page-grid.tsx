import { GripVertical, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { pageRenderKey, type PageRef } from '../../../lib/tools/pdf/pages';
import type { PreviewResult } from '../../../lib/workers/pdf/types';
import { Button } from '../../ui/button';
import { useObjectUrl } from '../use-object-url';

const rowHeight = 184;
const gap = 8;

interface GridProps {
  pages: readonly PageRef[];
  selected: ReadonlySet<string>;
  locked: boolean;
  render?: (page: PageRef, edge: number) => Promise<PreviewResult>;
  onSelect: (id: string, range: boolean, toggle: boolean) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  onMove: (id: string, target: string, after: boolean) => void;
  onFileTarget: (file?: string) => void;
  onInsert: (id: string, file: string) => void;
}

type Marker = { page?: string; file?: string; after?: boolean };

export function PageGrid({ pages, selected, locked, render, onSelect, onRotate, onDelete, onOpen, onMove, onFileTarget, onInsert }: GridProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ columns: 2, height: 360 });
  const [scroll, setScroll] = useState(0);
  const [cache, setCache] = useState<ReadonlyMap<string, Blob | null>>(() => new Map());
  const request = useRef(false);
  const alive = useRef(false);
  const focus = useRef<string>(undefined);
  const pointer = useRef<{ handle: number; id: string; x: number; y: number; moved: boolean }>(null);
  const position = useRef<{ x: number; y: number }>(null);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const [marker, setMarker] = useState<Marker>({});
  const [draggedId, setDraggedId] = useState<string>();
  const { columns, height } = box;
  const rows = Math.ceil(pages.length / columns);
  const firstVisible = Math.floor(scroll / rowHeight);
  const lastVisible = Math.min(rows, Math.ceil((scroll + height) / rowHeight));
  const first = Math.max(0, firstVisible - 1);
  const last = Math.min(rows, lastVisible + 1);
  const visible = pages.slice(firstVisible * columns, lastVisible * columns);
  const next = visible.find(page => !cache.has(pageRenderKey(page)));
  const nextKey = next && pageRenderKey(next);
  const mounted = pages.slice(first * columns, last * columns).map((page, offset) => ({ page, index: first * columns + offset }));
  if (draggedId && !mounted.some(({ page }) => page.id === draggedId)) {
    const index = pages.findIndex(page => page.id === draggedId);
    if (index >= 0) mounted.push({ page: pages[index], index });
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelAnimationFrame(frame.current);
    };
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setBox({
      columns: Math.max(1, Math.floor((track.current!.clientWidth + gap) / (132 + gap))),
      height: element.clientHeight,
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const id = focus.current;
    if (!id) return;
    const button = viewport.current?.querySelector<HTMLButtonElement>(`[data-pdf-page="${id}"] .pdf-select-page`);
    if (button) {
      button.focus({ preventScroll: true });
      focus.current = undefined;
    }
  });

  useEffect(() => {
    if (locked || request.current || !next || !nextKey || !render) return;
    request.current = true;
    void render(next, 228).then(result => result.blob, () => null).then(blob => {
      request.current = false;
      if (!alive.current) return;
      setCache(previous => {
        const updated = new Map(previous);
        updated.set(nextKey, blob);
        while (updated.size > 48) updated.delete(updated.keys().next().value!);
        return updated;
      });
    });
  }, [cache, locked, next, nextKey, render]);

  function focusAt(index: number) {
    const node = viewport.current!;
    if (!pages[index]) return;
    focus.current = pages[index].id;
    const top = Math.floor(index / columns) * rowHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + rowHeight > node.scrollTop + node.clientHeight) node.scrollTop = top + rowHeight - node.clientHeight;
    setScroll(node.scrollTop);
    const button = node.querySelector<HTMLButtonElement>(`[data-pdf-page="${focus.current}"] .pdf-select-page`);
    if (button) {
      button.focus({ preventScroll: true });
      focus.current = undefined;
    }
  }

  function key(event: KeyboardEvent, index: number) {
    if (locked) return;
    const current = pages[index];
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : index + (delta ?? 0);
    if (target === index || target < 0 || target >= pages.length) return;
    event.preventDefault();
    if (event.altKey || event.ctrlKey || event.metaKey) {
      const direction = target > index ? 1 : -1;
      let destination = target;
      while (selected.has(current.id) && pages[destination] && selected.has(pages[destination].id)) destination += direction;
      if (!pages[destination]) return;
      onMove(current.id, pages[destination].id, direction > 0);
      focus.current = current.id;
      return;
    }
    if (event.shiftKey) onSelect(pages[target].id, true, false);
    focusAt(target);
  }

  function hit(x: number, y: number): Marker {
    const element = document.elementFromPoint(x, y);
    const cell = element?.closest<HTMLElement>('[data-pdf-page]');
    if (cell) {
      const { left, width } = cell.getBoundingClientRect();
      return { page: cell.dataset.pdfPage, after: x >= left + width / 2 };
    }
    return { file: element?.closest<HTMLElement>('[data-file-id]')?.dataset.fileId };
  }

  function drawDrag() {
    frame.current = 0;
    const point = position.current;
    const node = viewport.current;
    if (!point || !node || !pointer.current?.moved) return;
    const { x, y } = point;
    const bounds = node.getBoundingClientRect();
    let scrolled = false;
    if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      const start = node.scrollTop;
      if (y < bounds.top + 20) node.scrollTop -= 8;
      if (y > bounds.bottom - 20) node.scrollTop += 8;
      scrolled = start !== node.scrollTop;
    } else {
      const start = window.scrollY;
      if (y < 24) window.scrollBy(0, -8);
      if (y > window.innerHeight - 24) window.scrollBy(0, 8);
      scrolled = start !== window.scrollY;
    }
    const target = hit(x, y);
    setMarker(target);
    onFileTarget(target.file);
    if (scrolled) frame.current = requestAnimationFrame(drawDrag);
  }

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (locked || !event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    pointer.current = { handle: event.pointerId, id, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = pointer.current;
    if (event.pointerId !== active?.handle) return;
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 6) return;
    if (!active.moved) {
      active.moved = true;
      setDraggedId(active.id);
    }
    position.current = { x: event.clientX, y: event.clientY };
    if (!frame.current) frame.current = requestAnimationFrame(drawDrag);
  }

  function end(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const active = pointer.current;
    if (event.pointerId !== active?.handle) return;
    pointer.current = null;
    position.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setDraggedId(undefined);
    setMarker({});
    onFileTarget();
    if (!active.moved) return;
    suppressClick.current = true;
    if (!commit || locked) return;
    const target = hit(event.clientX, event.clientY);
    if (target.page) onMove(active.id, target.page, Boolean(target.after));
    if (target.file) onInsert(active.id, target.file);
  }

  return (
    <div className="pdf-grid" ref={viewport} aria-label="Pages in document" role="region"
      onScroll={event => setScroll(event.currentTarget.scrollTop)}>
      <div className="pdf-track" ref={track} role="list" style={{ height: rows * rowHeight - gap }}>
        {mounted.map(({ page, index }) => {
          const thumbnail = cache.get(pageRenderKey(page));
          const onKey = (event: KeyboardEvent) => key(event, index);
          return <div key={page.id} className="pdf-cell" data-pdf-page={page.id} role="listitem"
            aria-setsize={pages.length} aria-posinset={index + 1}
            data-drop={marker.page === page.id ? marker.after ? 'after' : 'before' : undefined}
            style={{
              top: Math.floor(index / columns) * rowHeight,
              height: rowHeight - gap,
              left: `calc((100% + ${gap}px) * ${index % columns} / ${columns})`,
              width: `calc((100% + ${gap}px) / ${columns} - ${gap}px)`,
            }}>
            <button type="button" className="pdf-select-page" aria-label={`Page ${index + 1}`} aria-pressed={selected.has(page.id)}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" disabled={locked}
              onKeyDown={onKey} onDoubleClick={() => onOpen(page.id)}
              onClick={event => onSelect(page.id, event.shiftKey, event.ctrlKey || event.metaKey)}>
              <PageThumbnail blob={thumbnail} />
              <span className="pdf-page-number">{index + 1}</span>
            </button>
            <div className="pdf-page-toolbar">
              <Button className="pdf-drag-page" variant="ghost" size="icon-sm" type="button"
                aria-label={`Drag page ${index + 1}`} title="Drag page or use Alt + Arrow keys" disabled={locked}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" onKeyDown={onKey} onClick={() => {
                  if (!suppressClick.current) onSelect(page.id, false, false);
                  suppressClick.current = false;
                }}
                onPointerDown={event => start(event, page.id)} onPointerMove={move}
                onPointerUp={event => end(event, true)} onPointerCancel={event => end(event, false)}
                onLostPointerCapture={event => end(event, false)}><GripVertical aria-hidden /></Button>
              <Button className="pdf-quick-action" variant="ghost" size="icon-sm" type="button"
                aria-label={`Rotate page ${index + 1}`} title={`Rotate page ${index + 1} right`} disabled={locked}
                onClick={() => onRotate(page.id)}><RotateCw aria-hidden /></Button>
              <Button className="pdf-quick-action" variant="ghost" size="icon-sm" type="button"
                aria-label={`Delete page ${index + 1}`} title={pages.length === 1 ? 'Keep at least one page in the PDF.' : `Delete page ${index + 1}`}
                disabled={locked || pages.length === 1} onClick={() => onDelete(page.id)}><Trash2 aria-hidden /></Button>
            </div>
          </div>;
        })}
      </div>
    </div>
  );
}

function PageThumbnail({ blob }: { blob?: Blob | null }) {
  const url = useObjectUrl(blob ?? undefined);
  return <span className="pdf-thumbnail">
    {url ? <img src={url} alt="" draggable={false} /> : blob === null ? <span>Preview unavailable</span> : <i aria-hidden />}
  </span>;
}
