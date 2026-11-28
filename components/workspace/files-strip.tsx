import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { isMobileDevice } from '../../lib/core/device';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { FileTile, type FileTileProps } from './file-tile';

type Tile = Omit<FileTileProps, 'canMoveLeft' | 'canMoveRight' | 'dragSource' | 'dropTarget' | 'onDrag' | 'onDragEnd' | 'onMove'>;

export function FilesStrip({ tiles, locked, onAdd, addLabel, empty, onMove, announcement, externalTarget, listRef }: {
  tiles: readonly Tile[];
  locked: boolean;
  onAdd: () => void;
  addLabel: string;
  empty: string;
  onMove: (id: string, index: number) => void;
  announcement: string;
  externalTarget?: string;
  listRef?: RefObject<HTMLUListElement | null>;
}) {
  const [drag, setDrag] = useState<{ id: string; target?: string }>();
  const defaultRef = useRef<HTMLUListElement>(null);
  const strip = listRef ?? defaultRef;
  const position = useRef<{ id: string; x: number; y: number }>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function targetAt({ x, y }: { x: number; y: number }) {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-file-id]')?.dataset.fileId;
  }

  function moveDrag(id: string, x: number, y: number) {
    position.current = { id, x, y };
    if (frame.current) return;
    const update = () => {
      frame.current = 0;
      const point = position.current;
      const list = strip.current;
      if (!point || !list) return;
      const bounds = list.getBoundingClientRect();
      const direction = point.x < bounds.left + 24 ? -1 : point.x > bounds.right - 24 ? 1 : 0;
      const offset = list.scrollLeft;
      if (direction && point.y >= bounds.top && point.y <= bounds.bottom) list.scrollLeft += 6 * direction;
      const target = targetAt(point);
      setDrag(previous => previous?.id === point.id && previous.target === target ? previous : { id: point.id, target });
      if (list.scrollLeft !== offset) frame.current = requestAnimationFrame(update);
    };
    frame.current = requestAnimationFrame(update);
  }

  function endDrag(commit: boolean) {
    const point = position.current;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    position.current = null;
    setDrag(undefined);
    if (commit && point) onMove(point.id, tiles.findIndex(tile => tile.id === targetAt(point)));
  }

  return (
    <Card className="workspace-card file-panel" role="region" aria-labelledby="files-title">
      <div className="panel-heading"><h2 id="files-title">Files</h2><span className="file-count">{tiles.length}</span></div>
      {!tiles.length ? <p className="section-note">{empty}</p> : <>
        {tiles.length > 1 && <p className="section-note">Drag thumbnails to reorder.</p>}
        <ul ref={strip} className="file-list" aria-label="Added files" data-touch={isMobileDevice() || undefined} tabIndex={locked ? 0 : undefined}>
          {tiles.map((tile, index) => <FileTile key={tile.id} {...tile}
            canMoveLeft={index > 0} canMoveRight={index < tiles.length - 1}
            dragSource={drag?.id === tile.id} dropTarget={externalTarget === tile.id || (drag?.target === tile.id && drag.id !== tile.id)}
            onDrag={(x, y) => moveDrag(tile.id, x, y)} onDragEnd={endDrag}
            onMove={direction => onMove(tile.id, index + direction)} />)}
          <li className="add-tile">
            <Button variant="outline" aria-label={addLabel} title={addLabel} disabled={locked} onClick={onAdd}><Plus aria-hidden /></Button>
          </li>
        </ul>
      </>}
      <p className="sr-only" role="status">{announcement}</p>
    </Card>
  );
}
