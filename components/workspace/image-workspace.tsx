'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, Check, ChevronLeft, ChevronRight, ImagePlus, Plus, Redo2, Undo2, X } from 'lucide-react';
import type { EditCommand, ToolProgress } from '../../lib/core/contracts';
import { activeCommands, createEditStack, recordEdit, redo, undo, type EditStack } from '../../lib/core/edit-stack';
import { imageTools } from '../../lib/tools/image';
import type { ImageAIResults } from '../../lib/tools/image/ai-results';
import { outputFormats } from '../../lib/tools/image/formats';
import { ImageWorkerClient } from '../../lib/workers/image-client';
import type { ImageExport, ImageInfo, ImageProgress, PreviewResult } from '../../lib/workers/image/types';
import { ToolPanel } from './tool-panel';

interface Entry {
  readonly id: string;
  readonly stack: EditStack;
  readonly status: 'pending' | 'ready' | 'paused' | 'error';
  readonly info?: ImageInfo;
  readonly error?: string;
  readonly exportError?: string;
}

interface Preview {
  readonly id: string;
  readonly stack: EditStack;
  readonly result: PreviewResult;
}

interface ExportJob {
  readonly kind: 'image' | 'zip';
  readonly entries: readonly Entry[];
}

const inputFormats = '.jpg,.jpeg,.png,.webp,.avif,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif';

function requestFor({ id, stack }: Entry) {
  return { id, original: stack.original, commands: activeCommands(stack) };
}

function useObjectUrl(blob?: Blob) {
  const [objectUrl, setObjectUrl] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) {
      setObjectUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return objectUrl?.blob === blob ? objectUrl?.url : undefined;
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
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(null);
  const dragDepth = useRef(0);
  const swipeStart = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const picker = useRef<HTMLInputElement>(null);

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

  const updateEntry = useCallback((id: string, update: Partial<Entry>) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...update } : entry));
  }, []);

  useEffect(() => {
    if (activeId) client.retainPreview(activeId);
    else client.stop();
  }, [activeId, client]);

  useEffect(() => {
    if (!work) return;
    let pending = true;
    const request = { ...requestFor(work), cache: shouldPreviewSelection };
    setPreviewProgress(undefined);
    client.run((worker, progress) => worker.renderPreview(request, progress), (progress) => {
      if (pending) setPreviewProgress(progress);
    }).then((result) => {
      if (!pending) return;
      pending = false;
      if (shouldPreviewSelection) setPreview({ id: work.id, stack: work.stack, result });
      updateEntry(work.id, { status: 'ready', info: result.info, error: undefined });
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

  function startExport(kind: ExportJob['kind'], files: readonly Entry[]) {
    setDownload(undefined);
    setNotice('');
    setExportProgress(undefined);
    setEntries((current) => current.map((entry) => (
      entry.exportError && files.some(({ id }) => id === entry.id) ? { ...entry, exportError: undefined } : entry
    )));
    setExportJob({ kind, entries: files });
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
        <h1>Images</h1>
        <button className="button primary" onClick={() => picker.current?.click()} disabled={jobsLocked}>
          <Plus size={19} aria-hidden /> Add images
        </button>
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
      <div className="workspace-grid">
        <section className="preview-panel" aria-labelledby="preview-title">
          <div className="panel-heading">
            <h2 id="preview-title">Preview</h2>
            {entries.length > 1 && (
              <div className="preview-navigation">
                <button className="icon-button" aria-label="Previous image" disabled={selectionIndex <= 0 || jobsLocked} onClick={() => selectAdjacent(-1)}>
                  <ChevronLeft size={19} aria-hidden />
                </button>
                <span>{selectionIndex + 1} / {entries.length}</span>
                <button className="icon-button" aria-label="Next image" disabled={selectionIndex >= entries.length - 1 || jobsLocked} onClick={() => selectAdjacent(1)}>
                  <ChevronRight size={19} aria-hidden />
                </button>
              </div>
            )}
          </div>
          <div
            ref={setPreviewTarget}
            className={`preview-stage ${previewUrl ? 'checkerboard' : ''}`}
            aria-busy={Boolean(selected && selected.id === work?.id)}
            onPointerDown={(event) => {
              if (event.pointerType !== 'touch') return;
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
              <div className="empty-state">
                <span className="empty-icon"><ImagePlus size={28} aria-hidden /></span>
                <h3>Add images to get started</h3>
                <p>Choose files, drop them here, or paste an image.</p>
                <p className="small">JPG, PNG, WebP, AVIF, GIF, HEIC</p>
              </div>
            )}
            {selected && previewUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- The preview URL points to a local Blob. */
              <img className="preview-image" src={previewUrl} alt={`Preview of ${selected.stack.original.name}`} draggable={false} />
            )}
            {selected && !previewUrl && selected.status === 'paused' && (
              <div className="empty-state">
                <p>Preview canceled.</p>
                <button className="button secondary" onClick={() => updateEntry(selected.id, { status: 'pending' })}>Retry preview</button>
              </div>
            )}
            {selected && !previewUrl && selected.status === 'error' && <p className="preview-error">{selected.error}</p>}
            {selected && !previewUrl && selected.status !== 'error' && selected.status !== 'paused' && (
              <p>Preparing image…</p>
            )}
            {selected && previewUrl && selected.status === 'paused' && (
              <button className="button secondary retry-overlay" onClick={() => updateEntry(selected.id, { status: 'pending' })}>Retry preview</button>
            )}
          </div>
          <div className="preview-footer">
            <span>{selectedInfo ? `${selectedInfo.width} × ${selectedInfo.height} px` : 'Dimensions appear after decoding'}</span>
            <div className="history-buttons" role="group" aria-label="Edit history">
              <button className="icon-button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!previewIsCurrent || !selected?.stack.cursor || jobsLocked}
                onClick={() => selected && edit(selected, undo(selected.stack))}><Undo2 size={18} aria-hidden /></button>
              <button className="icon-button" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!previewIsCurrent || !selected || selected.stack.cursor >= selected.stack.commands.length || jobsLocked}
                onClick={() => selected && edit(selected, redo(selected.stack))}><Redo2 size={18} aria-hidden /></button>
            </div>
          </div>
        </section>

        <aside className="workspace-sidebar" aria-label="Files and export settings">
          <section className="file-panel" aria-labelledby="files-title">
            <div className="panel-heading"><h2 id="files-title">Files</h2><span>{entries.length}</span></div>
            {entries.length === 0 && <p className="section-note">Added images appear here.</p>}
            <ul className="file-list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <div className="file-row">
                    <button className="select-file" aria-current={entry.id === selected?.id} disabled={jobsLocked}
                      onClick={() => setSelectedId(entry.id)}>
                      <span>{entry.stack.original.name}</span>
                      <small>
                        {entry.id === exportProgress?.id
                          ? exportProgress.stage
                          : entry.id === work?.id
                            ? previewProgress?.id === entry.id ? previewProgress.stage : 'Checking'
                            : entry.status === 'ready' ? 'Ready' : entry.status === 'pending' ? 'Queued' : entry.status === 'paused' ? 'Canceled' : 'Could not open'}
                      </small>
                    </button>
                    <button className="icon-button remove-file" aria-label={`Remove ${entry.stack.original.name}`} disabled={jobsLocked}
                      onClick={() => remove(entry)}><X size={17} aria-hidden /></button>
                  </div>
                  {(entry.error || entry.exportError) && <p className="file-error" role="alert">{entry.error || entry.exportError}</p>}
                </li>
              ))}
            </ul>
          </section>

          <section className="settings-panel" aria-labelledby="tools-title">
            <div className="panel-heading"><h2 id="tools-title">Tools</h2></div>
            {selected && selectedInfo && (
              <ToolPanel revision={selected.stack}
                registry={imageTools} context={{
                  original: selected.stack.original, editKey, aiResults, releaseImageMemory: () => client.releaseFullPreview(),
                  backgroundColor: selectedInfo.backgroundColor,
                  hasAlpha: selectedInfo.hasAlpha, size: selectedInfo, previewUrl, previewBlob: shownPreview?.result.blob,
                  previewTarget, renderDraft, preparePreview, upscale: selectedInfo.upscale, disabled: toolsDisabled,
                }}
                initialOptions={{
                  ...Object.fromEntries(activeCommands(selected.stack)
                    .filter(command => imageTools.get(command.toolId).rememberOptions)
                    .map(command => [command.toolId, command.options])),
                  convert: selectedInfo.output,
                }}
                disabled={toolsDisabled}
                onBusyChange={setToolBusy}
                onApply={(command: EditCommand) => edit(selected, recordEdit(selected.stack, command))} />
            )}
            {(!selected || !selectedInfo) && <p className="section-note">Select a decoded image to edit its output.</p>}
          </section>

          <section className="export-panel" aria-labelledby="export-title">
            <div className="panel-heading"><h2 id="export-title">Export</h2></div>
            <div className="export-content">
              {selectedInfo && <p className="output-summary">
                {outputFormats[selectedInfo.output.format].label}
                {outputFormats[selectedInfo.output.format].lossy && ` · Quality ${selectedInfo.output.quality}%`}
                {selectedInfo.hasAlpha && selectedInfo.output.format === 'jpeg' && ` · ${selectedInfo.backgroundColor ?? (selectedInfo.output.background === '#ffffff' ? 'White' : 'Black')} background`}
              </p>}
              <p className="section-note">Exports use the original pixels and strip EXIF metadata.</p>
              <div className="export-buttons">
                <button className="button primary" disabled={selected?.status !== 'ready' || !previewIsCurrent || jobsLocked}
                  onClick={() => selected && startExport('image', [selected])}>
                  <ArrowDownToLine size={17} aria-hidden /> Export image
                </button>
                <button className="button secondary" disabled={completed.length < 2 || jobsLocked || Boolean(work) || entries.some(({ status }) => status === 'paused')}
                  onClick={() => startExport('zip', completed)}>
                  <Archive size={17} aria-hidden /> Export ZIP
                </button>
              </div>
              <p className="job-status" role="status" aria-live="polite">
                {exportJob
                  ? exportProgress ? `${jobMessage(exportProgress)}${exportProgress.detail ? ' · File' : ''} ${exportProgress.index} of ${exportProgress.total}…` : 'Starting export…'
                  : work ? `${previewProgress?.id === work.id ? jobMessage(previewProgress) : 'Checking'} ${work.stack.original.name}…` : notice}
              </p>
              {exportJob && <button className="button secondary" onClick={() => {
                setExportJob(undefined);
                setExportProgress(undefined);
                setNotice('Export canceled.');
              }}>Cancel export</button>}
              {!exportJob && work && <button className="button secondary" onClick={() => cancelPreview(work)}>Cancel preview</button>}
              {download && downloadUrl && (
                <a className="button save-button" href={downloadUrl} download={download.name}>
                  <Check size={17} aria-hidden /> Save to device
                </a>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
