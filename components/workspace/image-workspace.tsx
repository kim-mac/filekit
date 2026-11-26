'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, Check, ChevronLeft, ChevronRight, Columns2, ImagePlus, Layers, Plus, Redo2, Undo2 } from 'lucide-react';
import type { EditCommand, ToolProgress } from '../../lib/core/contracts';
import { activeCommands, createEditStack, recordEdit, redo, undo, type EditStack } from '../../lib/core/edit-stack';
import { imageTools } from '../../lib/tools/image';
import type { ImageAIResults } from '../../lib/tools/image/ai-results';
import { outputFormats } from '../../lib/tools/image/formats';
import { ImageWorkerClient } from '../../lib/workers/image-client';
import type { ImageExport, ImageInfo, ImageProgress, PreviewResult } from '../../lib/workers/image/types';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ColorField } from '../ui/color-field';
import { Toggle } from '../ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { FileTile } from './file-tile';
import { ImageComparison } from './image-comparison';
import { ToolPanel } from './tool-panel';
import { useObjectUrl } from './use-object-url';

interface Entry {
  readonly id: string;
  readonly stack: EditStack;
  readonly status: 'pending' | 'ready' | 'paused' | 'error';
  readonly info?: ImageInfo;
  readonly error?: string;
  readonly exportError?: string;
  readonly thumbnail?: Blob;
}

interface Preview {
  readonly id: string;
  readonly stack: EditStack;
  readonly result: PreviewResult;
}

interface ExportJob {
  readonly kind: 'image' | 'zip';
  readonly entries: readonly Entry[];
  readonly direct?: boolean;
}

const inputFormats = '.jpg,.jpeg,.png,.webp,.avif,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif';

function requestFor({ id, stack }: Entry) {
  return { id, original: stack.original, commands: activeCommands(stack) };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Image processing failed. Try again.';
}

function jobMessage(update: ImageProgress) {
  return update.tiles ? `${update.detail} · Tile ${update.tiles.done} of ${update.tiles.total}` : update.detail ?? update.stage;
}

export function ImageWorkspace() {
  const [client] = useState(() => new ImageWorkerClient());
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [previewProgress, setPreviewProgress] = useState<ImageProgress>();
  const [toolBusy, setToolBusy] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob>();
  const [exportProgress, setExportProgress] = useState<ImageProgress>();
  const [download, setDownload] = useState<ImageExport>();
  const [directDownload, setDirectDownload] = useState<ImageExport>();
  const save = useRef<HTMLAnchorElement>(null);
  const [comparing, setComparing] = useState(false);
  const [split, setSplit] = useState(50);
  const [before, setBefore] = useState<{ key: string; blob: Blob }>();
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(null);
  const dragDepth = useRef(0);
  const swipeStart = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const picker = useRef<HTMLInputElement>(null);
  const fileStrip = useRef<HTMLUListElement>(null);

  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const completed = entries.filter((entry) => entry.status === 'ready');
  const selectionIndex = selected ? entries.indexOf(selected) : -1;
  const shownPreview = preview?.id === selected?.id ? preview : undefined;
  const previewIsCurrent = Boolean(shownPreview && shownPreview.stack === selected?.stack);
  const shouldPreviewSelection = selected?.status === 'pending' || (selected?.status === 'ready' && !previewIsCurrent);
  const jobsLocked = Boolean(exportJob) || toolBusy;
  const work = jobsLocked ? undefined : shouldPreviewSelection ? selected : entries.find((entry) => entry.status === 'pending');
  const previewUrl = useObjectUrl(shownPreview?.result.blob);
  const downloadUrl = useObjectUrl(download?.blob);
  const mapping = shownPreview?.result.mapping;
  const comparisonKey = selected && mapping ? JSON.stringify([selected.id, mapping]) : undefined;
  const comparisonUrl = useObjectUrl(comparing && previewIsCurrent && selected?.stack.cursor &&
    before?.key === comparisonKey ? before?.blob : undefined);
  const comparisonOriginal = selected?.stack.original;
  const beforeKey = before?.key;
  const selectedInfo = selected?.info;
  const activeId = selected?.id;
  const activeStack = selected?.stack;
  const aiResults = useMemo<ImageAIResults>(() => ({}), [activeId]);
  const editKey = useMemo(() => activeStack ? JSON.stringify(activeCommands(activeStack)) : '', [activeStack]);
  const renderDraft = useCallback(async (command: EditCommand) => {
    if (activeId && activeStack) {
      return client.renderDraft({ id: activeId, commands: [...activeCommands(activeStack), command] });
    }
  }, [activeId, activeStack, client]);
  const preparePreview = useCallback(async (command: EditCommand, signal: AbortSignal, report: (update: ToolProgress) => void) => {
    if (!activeId || !activeStack) throw new Error('Select an image before applying this edit.');
    signal.throwIfAborted();
    const abort = () => client.stop();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await client.run((worker, progress) => worker.renderPreview({
        id: activeId, original: activeStack.original, commands: [...activeCommands(activeStack), command],
      }, progress), update => report({
        message: jobMessage(update),
        progress: update.tiles ? 0.05 + 0.9 * update.tiles.done / update.tiles.total : update.stage === 'Rendering preview' ? 0.98 : 0.02,
      }));
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }, [activeId, activeStack, client]);
  const toolsDisabled = !previewIsCurrent || selected?.status !== 'ready' || jobsLocked || Boolean(work);

  useEffect(() => {
    if (!comparing || !previewIsCurrent || jobsLocked || work || !activeId || !comparisonOriginal ||
        !comparisonKey || beforeKey === comparisonKey || !mapping) return;
    let current = true;
    client.renderComparison({ id: activeId, original: comparisonOriginal, mapping }).then(blob => {
      if (current && blob) setBefore({ key: comparisonKey, blob });
    }, () => {
      if (current) {
        setComparing(false);
        setNotice('Could not show the original. Try Compare again.');
      }
    });
    return () => { current = false; };
  }, [activeId, beforeKey, client, comparing, comparisonKey, comparisonOriginal, jobsLocked, mapping, previewIsCurrent, work]);

  useEffect(() => {
    if (download && directDownload === download && downloadUrl && save.current) {
      save.current.click();
      setDirectDownload(undefined);
    }
  }, [directDownload, download, downloadUrl]);

  const updateEntry = useCallback((id: string, update: Partial<Entry>) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...update } : entry));
  }, []);

  useEffect(() => {
    setBefore(undefined);
    if (activeId) client.retainPreview(activeId);
    else client.stop();
  }, [activeId, client]);

  useEffect(() => {
    const strip = fileStrip.current;
    const button = strip?.querySelector('[aria-current="true"]');
    if (!strip || !button) return;
    const visible = strip.getBoundingClientRect();
    const tile = button.getBoundingClientRect();
    if (tile.left < visible.left) strip.scrollBy({ left: tile.left - visible.left - 5 });
    if (tile.right > visible.right) strip.scrollBy({ left: tile.right - visible.right + 5 });
  }, [activeId]);

  useEffect(() => {
    if (!work) return;
    let pending = true;
    const request = { ...requestFor(work), cache: shouldPreviewSelection, thumbnail: !work.thumbnail };
    setPreviewProgress(undefined);
    client.run((worker, progress) => worker.renderPreview(request, progress), (progress) => {
      if (pending) setPreviewProgress(progress);
    }).then((result) => {
      if (!pending) return;
      pending = false;
      if (shouldPreviewSelection) setPreview({ id: work.id, stack: work.stack, result });
      updateEntry(work.id, { status: 'ready', info: result.info, thumbnail: result.thumbnail ?? work.thumbnail, error: undefined });
    }, (error: unknown) => {
      if (!pending) return;
      pending = false;
      updateEntry(work.id, { status: 'error', error: message(error) });
    });
    return () => {
      if (!pending) return;
      pending = false;
      client.stop();
    };
  }, [client, shouldPreviewSelection, updateEntry, work]);

  useEffect(() => {
    if (!exportJob) return;
    let pending = true;
    const progress = (update: ImageProgress) => {
      if (pending) setExportProgress(update);
    };
    const finish = (result: ImageExport | undefined, status: string) => {
      if (!pending) return;
      pending = false;
      setDownload(result);
      setDirectDownload(exportJob.direct ? result : undefined);
      setNotice(status);
      setExportJob(undefined);
      setExportProgress(undefined);
    };
    if (exportJob.kind === 'image') {
      const entry = exportJob.entries[0];
      client.run((worker, report) => worker.exportImage(requestFor(entry), report), progress).then(
        (result) => finish(result, 'Image ready to save.'),
        (error: unknown) => {
          if (pending) updateEntry(entry.id, { exportError: message(error) });
          finish(undefined, 'Export failed. See the file for details.');
        },
      );
    } else {
      const requests = exportJob.entries.map(requestFor);
      client.run((worker, report) => worker.exportZip(requests, report), progress).then(
        ({ blob, failures, count }) => {
          if (!pending) return;
          for (const failure of failures) updateEntry(failure.id, { exportError: failure.message });
          const status = blob ? `ZIP ready to save with ${count} ${count === 1 ? 'image' : 'images'}.` : 'No images could be exported.';
          finish(
            blob ? { blob, name: 'filekit-images.zip' } : undefined,
            failures.length ? `${status} ${failures.length} failed. See the files for details.` : status,
          );
        },
        (error: unknown) => finish(undefined, message(error)),
      );
    }
    return () => {
      if (!pending) return;
      pending = false;
      client.stop();
    };
  }, [client, exportJob, updateEntry]);

  useEffect(() => () => client.stop(), [client]);

  const addFiles = useCallback((files: readonly File[]) => {
    if (!files.length || jobsLocked) return;
    const added = files.map((file): Entry => ({
      id: crypto.randomUUID(), stack: createEditStack(file), status: 'pending',
    }));
    setEntries((current) => [...current, ...added]);
    setSelectedId((current) => current ?? added[0].id);
    setDownload(undefined);
    setNotice('');
  }, [jobsLocked]);

  function remove(entry: Entry) {
    const index = entries.indexOf(entry);
    setEntries(entries.filter(({ id }) => id !== entry.id));
    if (entry.id === selected?.id) setSelectedId(entries[index + 1]?.id ?? entries[index - 1]?.id);
    if (entry.id === preview?.id) setPreview(undefined);
    setDownload(undefined);
    setNotice('');
  }

  const edit = useCallback((entry: Entry, stack: EditStack) => {
    if (stack === entry.stack) return;
    updateEntry(entry.id, { stack, exportError: undefined });
    setDownload(undefined);
    setNotice('');
  }, [updateEntry]);

  useLayoutEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const files = Array.from(clipboard.files);
      if (!files.length) {
        for (const item of Array.from(clipboard.items)) {
          const file = item.kind === 'file' ? item.getAsFile() : null;
          if (file) files.push(file);
        }
      }
      if (!files.length || jobsLocked) return;
      event.preventDefault();
      addFiles(files);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (!event.metaKey && !event.ctrlKey) || event.altKey || jobsLocked) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        picker.current?.click();
      }
      if (!selected || selected.status !== 'ready' || !previewIsCurrent) return;
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        edit(selected, event.shiftKey || key === 'y' ? redo(selected.stack) : undo(selected.stack));
      }
    };
    window.addEventListener('paste', paste);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('paste', paste);
      window.removeEventListener('keydown', keydown);
    };
  }, [addFiles, edit, jobsLocked, previewIsCurrent, selected]);

  function selectAdjacent(direction: number) {
    const next = entries[selectionIndex + direction];
    if (next && !jobsLocked) setSelectedId(next.id);
  }

  function startExport(kind: ExportJob['kind'], files: readonly Entry[], direct = false) {
    setDownload(undefined);
    setNotice('');
    setExportProgress(undefined);
    setEntries((current) => current.map((entry) => (
      entry.exportError && files.some(({ id }) => id === entry.id) ? { ...entry, exportError: undefined } : entry
    )));
    setExportJob({ kind, entries: files, direct });
  }

  function cancelPreview(entry: Entry) {
    updateEntry(entry.id, { status: 'paused' });
  }

  return (
    <main
      className={`workspace ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current++;
        if (!jobsLocked) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = jobsLocked ? 'none' : 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="workspace-heading">
        <div className="workspace-title">
          <span className="workspace-icon"><Layers size={24} aria-hidden /></span>
          <div><h1>Images</h1><p>Edit and export images on your device.</p></div>
        </div>
        <input
          ref={picker}
          aria-label="Image files"
          type="file"
          multiple
          accept={inputFormats}
          hidden
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }}
        />
      </div>
      <TooltipProvider delayDuration={500}>
      <div className="workspace-grid">
        <Card className="workspace-card preview-panel" role="region" aria-labelledby="preview-title"
          onClick={selected ? undefined : event => {
            if (!(event.target as HTMLElement).closest('button')) picker.current?.click();
          }}>
          <div className="panel-heading">
            <h2 id="preview-title">Preview</h2>
            <div className="preview-controls">
              <Toggle size="sm" variant="outline" pressed={Boolean(comparing && selected?.stack.cursor)}
                disabled={!previewIsCurrent || !selected?.stack.cursor || jobsLocked}
                onPressedChange={setComparing} aria-label="Compare">
                <Columns2 aria-hidden /> Compare
              </Toggle>
            {entries.length > 1 && (
              <div className="preview-navigation">
                <Button variant="ghost" size="icon-sm" aria-label="Previous image" disabled={selectionIndex <= 0 || jobsLocked} onClick={() => selectAdjacent(-1)}>
                  <ChevronLeft size={19} aria-hidden />
                </Button>
                <span>{selectionIndex + 1} / {entries.length}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Next image" disabled={selectionIndex >= entries.length - 1 || jobsLocked} onClick={() => selectAdjacent(1)}>
                  <ChevronRight size={19} aria-hidden />
                </Button>
              </div>
            )}
            </div>
          </div>
          <div
            ref={setPreviewTarget}
            className={`preview-stage ${previewUrl ? 'checkerboard' : ''} ${comparisonUrl ? 'is-comparing' : ''}`}
            aria-busy={Boolean(selected && selected.id === work?.id)}
            onPointerDown={(event) => {
              if (event.pointerType !== 'touch' || comparisonUrl) return;
              swipeStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            }}
            onPointerCancel={() => { swipeStart.current = undefined; }}
            onPointerUp={(event) => {
              const start = swipeStart.current;
              swipeStart.current = undefined;
              if (!start || start.id !== event.pointerId) return;
              const distance = event.clientX - start.x;
              if (Math.abs(distance) > 50 && Math.abs(distance) > Math.abs(event.clientY - start.y)) {
                selectAdjacent(distance < 0 ? 1 : -1);
              }
            }}
          >
            {!selected && (
              <button type="button" className="empty-state empty-picker" onClick={() => picker.current?.click()}>
                <span className="empty-icon"><ImagePlus size={30} aria-hidden /></span>
                <strong>Drop images here</strong>
                <span><b>Choose files</b> or paste an image</span>
                <small>JPG, PNG, WebP, AVIF, GIF, HEIC</small>
              </button>
            )}
            {selected && previewUrl && shownPreview && (
              <ImageComparison name={selected.stack.original.name} editedUrl={previewUrl} originalUrl={comparisonUrl}
                width={shownPreview.result.info.width} height={shownPreview.result.info.height}
                position={split} onPositionChange={setSplit} />
            )}
            {selected && !previewUrl && selected.status === 'paused' && (
              <div className="empty-state">
                <p>Preview canceled.</p>
                <Button variant="outline" onClick={() => updateEntry(selected.id, { status: 'pending' })}>Retry preview</Button>
              </div>
            )}
            {selected && !previewUrl && selected.status === 'error' && <p className="preview-error">{selected.error}</p>}
            {selected && !previewUrl && selected.status !== 'error' && selected.status !== 'paused' && (
              <p>Preparing image…</p>
            )}
            {selected && previewUrl && selected.status === 'paused' && (
              <Button variant="outline" className="retry-overlay" onClick={() => updateEntry(selected.id, { status: 'pending' })}>Retry preview</Button>
            )}
          </div>
          <div className="preview-footer">
            <span>{selectedInfo ? `${selectedInfo.width} × ${selectedInfo.height} px` : 'Dimensions appear after decoding'}</span>
            <div className="history-buttons" role="group" aria-label="Edit history">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Undo" disabled={!previewIsCurrent || !selected?.stack.cursor || jobsLocked}
                    onClick={() => selected && edit(selected, undo(selected.stack))}><Undo2 aria-hidden /></Button>
                </TooltipTrigger>
                <TooltipContent>Undo (Ctrl/⌘ Z)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Redo" disabled={!previewIsCurrent || !selected || selected.stack.cursor >= selected.stack.commands.length || jobsLocked}
                    onClick={() => selected && edit(selected, redo(selected.stack))}><Redo2 aria-hidden /></Button>
                </TooltipTrigger>
                <TooltipContent>Redo (Ctrl/⌘ Shift Z)</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Card>

        <Card className="workspace-card file-panel" role="region" aria-labelledby="files-title">
          <div className="panel-heading"><h2 id="files-title">Files</h2><span className="file-count">{entries.length}</span></div>
          {entries.length === 0 ? <p className="section-note">Added images appear here.</p> : (
            <ul ref={fileStrip} className="file-list" aria-label="Added files">
              {entries.map((entry) => {
                const applying = toolBusy && entry.id === activeId;
                const processing = applying || entry.id === exportProgress?.id || entry.id === work?.id;
                const status = entry.id === exportProgress?.id ? exportProgress.stage
                  : entry.id === work?.id ? previewProgress?.id === entry.id ? previewProgress.stage : 'Checking'
                  : applying ? 'Applying edit'
                  : entry.exportError ? 'Export failed'
                  : entry.status === 'ready' ? 'Ready' : entry.status === 'pending' ? 'Queued'
                  : entry.status === 'paused' ? 'Canceled' : 'Could not open';
                return <FileTile key={entry.id} name={entry.stack.original.name} thumbnail={entry.thumbnail}
                  selected={entry.id === selected?.id} processing={processing} status={status}
                  error={entry.error || entry.exportError} ready={entry.status === 'ready'} disabled={jobsLocked}
                  onSelect={() => setSelectedId(entry.id)} onRemove={() => remove(entry)}
                  onDownload={() => startExport('image', [entry], true)} />;
              })}
              <li className="add-tile">
                <Button variant="outline" disabled={jobsLocked} onClick={() => picker.current?.click()}>
                  <Plus aria-hidden /> <span className="sr-only">Add more images</span>
                </Button>
              </li>
            </ul>
          )}
        </Card>

        <aside className="workspace-sidebar" aria-label="Editing and export">
          <Card className="workspace-card settings-panel" role="region" aria-labelledby="tools-title">
            <div className="panel-heading"><h2 id="tools-title">Tools</h2></div>
            {selected && selectedInfo && (
              <ToolPanel revision={selected.stack}
                registry={imageTools} context={{
                  original: selected.stack.original, editKey, aiResults, releaseImageMemory: () => client.releaseFullPreview(),
                  originalFormat: selectedInfo.format,
                  hasAlpha: selectedInfo.hasAlpha, size: selectedInfo, previewUrl, previewBlob: shownPreview?.result.blob,
                  previewTarget, renderDraft, preparePreview, upscale: selectedInfo.upscale, disabled: toolsDisabled,
                }}
                initialOptions={{
                  ...Object.fromEntries(activeCommands(selected.stack)
                    .filter(command => imageTools.get(command.toolId).rememberOptions)
                    .map(command => [command.toolId, command.options])),
                  convert: selectedInfo.conversion,
                }}
                disabled={toolsDisabled}
                onBusyChange={setToolBusy}
                onApply={(command: EditCommand) => edit(selected, recordEdit(selected.stack, command))} />
            )}
            {(!selected || !selectedInfo) && <p className="section-note">Select a decoded image to edit its output.</p>}
          </Card>

          <Card className="workspace-card export-panel" role="region" aria-labelledby="export-title">
            <div className="panel-heading"><h2 id="export-title">Export</h2></div>
            <div className="export-content">
              {selectedInfo && <p className="output-summary">
                {outputFormats[selectedInfo.output.format].label}
                {outputFormats[selectedInfo.output.format].lossy && ` · Quality ${selectedInfo.output.quality}%`}
              </p>}
              {selected && selectedInfo?.hasAlpha && !outputFormats[selectedInfo.output.format].alpha && (
                <ColorField label="Fill transparent areas with" value={selectedInfo.output.background} disabled={toolsDisabled}
                  onChange={background => edit(selected, recordEdit(selected.stack, {
                    toolId: 'convert', options: { ...selectedInfo.conversion, background },
                  }))} />
              )}
              <p className="section-note">Exports use the original pixels and strip EXIF metadata.</p>
              <div className="export-buttons">
                <Button disabled={selected?.status !== 'ready' || !previewIsCurrent || jobsLocked}
                  onClick={() => selected && startExport('image', [selected])}>
                  <ArrowDownToLine aria-hidden /> Export image
                </Button>
                <Button variant="outline" disabled={completed.length < 2 || jobsLocked || Boolean(work) || entries.some(({ status }) => status === 'paused')}
                  onClick={() => startExport('zip', completed)}>
                  <Archive size={17} aria-hidden /> Export ZIP
                </Button>
              </div>
              <p className="job-status" role="status" aria-live="polite">
                {exportJob
                  ? exportProgress ? `${jobMessage(exportProgress)}${exportProgress.detail ? ' · File' : ''} ${exportProgress.index} of ${exportProgress.total}…` : 'Starting export…'
                  : work ? `${previewProgress?.id === work.id ? jobMessage(previewProgress) : 'Checking'} ${work.stack.original.name}…` : notice}
              </p>
              {exportJob && <Button variant="outline" onClick={() => {
                setExportJob(undefined);
                setExportProgress(undefined);
                setNotice('Export canceled.');
              }}>Cancel export</Button>}
              {!exportJob && work && <Button variant="outline" onClick={() => cancelPreview(work)}>Cancel preview</Button>}
              {download && downloadUrl && (
                <Button asChild variant="secondary">
                  <a ref={save} href={downloadUrl} download={download.name}>
                    <Check aria-hidden /> Save to device
                  </a>
                </Button>
              )}
            </div>
          </Card>
        </aside>
      </div>
      </TooltipProvider>
    </main>
  );
}
