import { ArrowLeft, ArrowRight, Check, Copy, Download, Ellipsis, Image, LoaderCircle, Pencil, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useId, useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent, type ReactNode } from 'react';
import { sanitizeBaseName } from '../../lib/core/file-name';
import { Button } from '../ui/button';
import { Notice } from '../ui/notice';
import { useObjectUrl } from './use-object-url';

export interface FileTileProps {
  id: string;
  name: string;
  baseName: string;
  extension: string;
  thumbnail?: Blob;
  thumbnailContent?: ReactNode;
  fallbackIcon?: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  selected: boolean;
  status: string;
  processing: boolean;
  error?: string;
  disabled: boolean;
  ready: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  dragSource: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCopy?: () => void;
  copyLabel?: string;
  onRemove: () => void;
  onRename: (name: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDrag: (x: number, y: number) => void;
  onDragEnd: (commit: boolean) => void;
}

export function FileTile({
  id, name, baseName, extension, thumbnail, thumbnailContent, fallbackIcon: Icon = Image, selected, status, processing, error, disabled, ready,
  canMoveLeft, canMoveRight, dragSource, dropTarget, onSelect, onDownload, onCopy, copyLabel, onRemove, onRename, onMove, onDrag, onDragEnd,
}: FileTileProps) {
  const url = useObjectUrl(thumbnail);
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputId = useId();
  const focusAfterRename = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== undefined;
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean }>(null);
  const suppressClick = useRef(false);
  const canDrag = !disabled && (canMoveLeft || canMoveRight);

  function closeRename() {
    focusAfterRename.current = true;
    setDraft(undefined);
    setInvalid(false);
  }

  function endDrag(event: PointerEvent, commit: boolean) {
    const start = pointer.current;
    if (event.pointerId !== start?.id) return;
    pointer.current = null;
    if (start.moved) {
      suppressClick.current = commit;
      if (commit) onDrag(event.clientX, event.clientY);
      onDragEnd(commit);
    }
  }

  return (
    <li className="file-tile" data-file-id={id} data-drag-source={dragSource || undefined} data-drop-target={dropTarget || undefined}>
      <div className="file-row" data-menu-open={menuOpen || undefined} data-selected={selected || undefined}>
        {draft === undefined ? (
          <>
            <button type="button" className="select-file" aria-current={selected}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight"
              disabled={disabled} onPointerDown={() => { suppressClick.current = false; }} onClick={event => {
                if (event.detail && suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onSelect();
              }} title={name} onKeyDown={event => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                if (!event.altKey && !event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                onSelect();
                onMove(event.key === 'ArrowLeft' ? -1 : 1);
              }}>
              <span className="file-thumbnail" data-draggable={canDrag || undefined}
                onPointerDown={event => {
                  if (!canDrag || !event.isPrimary || event.button !== 0) return;
                  pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const start = pointer.current;
                  if (event.pointerId !== start?.id) return;
                  if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 7) return;
                  start.moved = true;
                  onDrag(event.clientX, event.clientY);
                }}
                onPointerUp={event => endDrag(event, true)}
                onPointerCancel={event => endDrag(event, false)}
                onLostPointerCapture={event => endDrag(event, false)}>
                {thumbnailContent ?? (url ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- Local worker thumbnail. */
                  <img src={url} alt="" draggable={false} />
                ) : <Icon size={21} aria-hidden />)}
              </span>
              <span className="file-name">{name}</span>
              <small className={error ? 'file-error' : ''}>
                {processing && <LoaderCircle size={12} className="file-spinner" aria-hidden />}
                {status}
              </small>
            </button>
            <div className="file-actions">
              <Button aria-label={`Download ${name}`} title="Download with edits" type="button" size="icon-sm"
                variant="secondary" disabled={disabled || !ready} onClick={onDownload}><Download aria-hidden /></Button>
              <Button ref={node => {
                if (node && focusAfterRename.current) {
                  focusAfterRename.current = false;
                  node.focus();
                }
              }} aria-label={`Rename ${name}`} title="Rename file" type="button" size="icon-sm"
                variant="secondary" disabled={disabled} onClick={() => setDraft(baseName)}><Pencil aria-hidden /></Button>
              <DropdownMenu.Root open={menuOpen} onOpenChange={open => {
                if (!open || !disabled) setMenuOpen(open);
              }} modal={false}>
                <DropdownMenu.Trigger asChild>
                  <Button aria-label={`Actions for ${name}`} title="File actions" type="button" size="icon-sm"
                    variant="secondary" aria-disabled={disabled || undefined} disabled={!ready && !canMoveLeft && !canMoveRight}>
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="file-menu" sideOffset={4} align="start">
                    {copyLabel && <DropdownMenu.Item disabled={!onCopy} onSelect={onCopy}><Copy size={16} aria-hidden /> {copyLabel}</DropdownMenu.Item>}
                    <DropdownMenu.Item disabled={!canMoveLeft} onSelect={() => onMove(-1)}><ArrowLeft size={16} aria-hidden /> Move left</DropdownMenu.Item>
                    <DropdownMenu.Item disabled={!canMoveRight} onSelect={() => onMove(1)}><ArrowRight size={16} aria-hidden /> Move right</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <Button aria-label={`Remove ${name}`} title="Remove file" type="button" size="icon-sm"
                variant="secondary" disabled={disabled} onClick={onRemove}><X aria-hidden /></Button>
            </div>
          </>
        ) : (
          <form className="file-rename" onSubmit={event => {
            event.preventDefault();
            if (disabled) return;
            const valid = sanitizeBaseName(draft);
            if (!valid) {
              setInvalid(true);
              return;
            }
            onRename(valid);
            closeRename();
          }} onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeRename();
            }
          }}>
            <label htmlFor={inputId}>File name</label>
            <div className="file-rename-input">
              <input id={inputId} value={draft} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${inputId}-error` : undefined}
                ref={input}
                onChange={event => { setDraft(event.target.value); setInvalid(false); }} />
              <span>{extension}</span>
            </div>
            {invalid && <p id={`${inputId}-error`} className="file-error" role="alert">Enter a file name.</p>}
            <div className="file-rename-actions">
              <Button type="submit" size="icon-sm" aria-label="Save file name" title="Save file name" disabled={disabled}><Check aria-hidden /></Button>
              <Button type="button" size="icon-sm" variant="outline" aria-label="Cancel rename" title="Cancel rename" onClick={closeRename}><X aria-hidden /></Button>
            </div>
          </form>
        )}
      </div>
      {error && <Notice variant="error">{error}</Notice>}
    </li>
  );
}
