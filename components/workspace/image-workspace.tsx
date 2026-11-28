'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, Check, ChevronLeft, ChevronRight, Columns2, ImagePlus, Layers, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import { processingMessage } from '../../lib/core/processing-error';
import { isMobileDevice } from '../../lib/core/device';
import { originalBaseName } from '../../lib/core/file-name';
import type { EditCommand, ToolProgress } from '../../lib/core/contracts';
import { activeCommands, createEditStack, recordEdit, redo, undo, type EditStack } from '../../lib/core/edit-stack';
import { imageTools } from '../../lib/tools/image';
import type { ImageAIResults } from '../../lib/tools/image/ai-results';
import type { Size } from '../../lib/tools/image/geometry';
import { iconSizes, outputFormats, transparencyWarning } from '../../lib/tools/image/formats';
import { formatBytes, formatDimensions, formatIconDimensions } from '../../lib/tools/image/size-estimate';
import { ImageWorkerClient } from '../../lib/workers/image-client';
import type { ImageExport, ImageInfo, ImageProgress, PreviewResult } from '../../lib/workers/image/types';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ColorField } from '../ui/color-field';
import { JobProgress } from '../ui/job-progress';
import { Notice } from '../ui/notice';
import { Toggle } from '../ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { FileTile } from './file-tile';
import { ImageComparison } from './image-comparison';
import { ImageDetails } from './image-details';
import { OutputEstimate, SizeEstimator } from './output-estimate';
import { usePreviewView } from './use-preview-view';
import { ToolPanel } from './tool-panel';
import { useObjectUrl } from './use-object-url';

interface Entry {
  readonly id: string;
  readonly stack: EditStack;
  readonly baseName?: string;
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

function requestFor({ id, stack, baseName }: Entry) {
  return { id, original: stack.original, commands: activeCommands(stack), baseName };
}

function fileExtension(entry: Entry) {
  if (entry.info) return `.${outputFormats[entry.info.output.format].extension}`;
  const name = entry.stack.original.name;
  return name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : '';
}

function fileName(entry: Entry) {
  return entry.baseName ? entry.baseName + fileExtension(entry) : entry.stack.original.name;
}

function previewJob(upscale: boolean, update?: ImageProgress): ToolProgress {
  const rendered = update?.stage === 'Rendering preview';
  const step = rendered ? upscale ? 3 : 2 : update?.stage === 'Upscaling' ? 2 : 1;
  const message = rendered ? 'Rendering preview' : step === 2 ? 'Upscaling image' : 'Preparing image';
  return { message, step, totalSteps: upscale ? 3 : 2, tiles: update?.tiles, download: update?.download };
}

function exportJobProgress(zip: boolean, update?: ImageProgress): ToolProgress {
  const stage = update?.stage;
  const step = stage === 'Packaging' ? 4 : stage === 'Encoding' ? 3 : stage === 'Applying edits' || stage === 'Upscaling' ? 2 : 1;
  const message = step === 4 ? 'Packaging ZIP' : step === 3 ? 'Encoding image' : step === 2 ? 'Applying edits' : 'Preparing image';
  return { message, step, totalSteps: zip ? 4 : 3, tiles: update?.tiles, download: update?.download };
}

export function ImageWorkspace() {
  const [client] = useState(() => new ImageWorkerClient());
  const [estimator] = useState(() => new SizeEstimator());
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
  const [exportError, setExportError] = useState('');
  const [exportWarnings, setExportWarnings] = useState<readonly string[]>([]);
  const [dismissedWarnings, setDismissedWarnings] = useState<ReadonlySet<string>>(() => new Set());
  const [fileAnnouncement, setFileAnnouncement] = useState('');
  const [fileDrag, setFileDrag] = useState<{ id: string; target?: string }>();
  const dragPosition = useRef<{ id: string; x: number; y: number }>(null);
  const dragFrame = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(null);
  const [draftSize, setDraftSize] = useState<Size>();
  const dragDepth = useRef(0);
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
  const previewSize = shownPreview?.result.info;
  const canvasSize = previewSize && !comparisonUrl ? draftSize ?? previewSize : previewSize;
  const viewport = usePreviewView(stage, canvasSize, selected?.id, entries.length > 1 ? selectAdjacent : undefined);
  const comparisonOriginal = selected?.stack.original;
  const beforeKey = before?.key;
  const comparisonPending = Boolean(comparing && previewIsCurrent && !jobsLocked && !work &&
    comparisonKey && beforeKey !== comparisonKey);
  const selectedInfo = selected?.info;
  const selectionWarning = selectedInfo?.hasAlpha && !outputFormats[selectedInfo.output.format].alpha
    ? transparencyWarning(selectedInfo.output) : '';
  const warnings = [...new Set([selectionWarning, ...exportWarnings])].filter(warning => warning && !dismissedWarnings.has(warning));
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
      }, progress), update => report(previewJob(command.toolId === 'upscale', update)));
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
        setExportError('Could not show the original. Try Compare again.');
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
  }, [activeId, selectionIndex]);

  const workId = work?.id;
  const workStack = work?.stack;
  const workThumbnail = work?.thumbnail;
  useEffect(() => {
    if (!workId || !workStack) return;
    let pending = true;
    const request = {
      id: workId, original: workStack.original, commands: activeCommands(workStack),
      cache: shouldPreviewSelection, thumbnail: !workThumbnail,
    };
    setPreviewProgress(undefined);
    client.run((worker, progress) => worker.renderPreview(request, progress), (progress) => {
      if (pending) setPreviewProgress(progress);
    }).then((result) => {
      if (!pending) return;
      pending = false;
      if (shouldPreviewSelection) setPreview({ id: workId, stack: workStack, result });
      updateEntry(workId, { status: 'ready', info: result.info, thumbnail: result.thumbnail ?? workThumbnail, error: undefined });
    }, (error: unknown) => {
      if (!pending) return;
      pending = false;
      updateEntry(workId, { status: 'error', error: processingMessage(error) });
    });
    return () => {
      if (!pending) return;
      pending = false;
      client.stop();
    };
  }, [client, shouldPreviewSelection, updateEntry, workId, workStack, workThumbnail]);

  useEffect(() => {
    if (!exportJob) return;
    let pending = true;
    const progress = (update: ImageProgress) => {
      if (!pending) return;
      setExportProgress(update);
    };
    const finish = (result: ImageExport | undefined, status: string, error = '') => {
      if (!pending) return;
      pending = false;
      setDownload(result);
      setDirectDownload(exportJob.direct ? result : undefined);
      setNotice(status);
      setExportError(error);
      setExportJob(undefined);
      setExportProgress(undefined);
    };
    if (exportJob.kind === 'image') {
      const entry = exportJob.entries[0];
      client.run((worker, report) => worker.exportImage(requestFor(entry), report), progress).then(
        (result) => finish(result, 'Image ready to save.'),
        (error: unknown) => {
          if (pending) updateEntry(entry.id, { exportError: processingMessage(error) });
          finish(undefined, '', 'Could not export this image. See the file for details.');
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
            blob ? status : '',
            failures.length ? `${failures.length} ${failures.length === 1 ? 'image could' : 'images could'} not be exported. See the files for details.` : '',
          );
        },
        (error: unknown) => finish(undefined, '', processingMessage(error)),
      );
    }
    return () => {
      if (!pending) return;
      pending = false;
      client.stop();
    };
  }, [client, exportJob, updateEntry]);

  useEffect(() => () => { client.stop(); estimator.stop(); }, [client, estimator]);
  useEffect(() => { if (jobsLocked) estimator.stop(); }, [estimator, jobsLocked]);

  const addFiles = useCallback((files: readonly File[]) => {
    if (!files.length || jobsLocked) return;
    const added = files.map((file): Entry => ({
      id: crypto.randomUUID(), stack: createEditStack(file), status: 'pending',
    }));
    setEntries((current) => [...current, ...added]);
    setSelectedId((current) => current ?? added[0].id);
    setDownload(undefined);
    setNotice('');
    setExportError('');
    setExportWarnings([]);
  }, [jobsLocked]);

  function remove(entry: Entry) {
    const index = entries.indexOf(entry);
    setEntries(entries.filter(({ id }) => id !== entry.id));
    if (entry.id === selected?.id) setSelectedId(entries[index + 1]?.id ?? entries[index - 1]?.id);
    if (entry.id === preview?.id) setPreview(undefined);
    const nextId = entries[index + 1]?.id ?? entries[index - 1]?.id;
    requestAnimationFrame(() => {
      const next = nextId && fileStrip.current?.querySelector<HTMLButtonElement>(`[data-file-id="${nextId}"] .select-file`);
      if (next) next.focus();
      else document.querySelector<HTMLButtonElement>('.empty-picker')?.focus();
    });
    setDownload(undefined);
    setNotice('');
    setExportError('');
    setExportWarnings([]);
  }

  const edit = useCallback((entry: Entry, stack: EditStack) => {
    if (stack === entry.stack) return;
    updateEntry(entry.id, { stack, exportError: undefined });
    setDownload(undefined);
    setNotice('');
    setExportError('');
    setExportWarnings([]);
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
      if ((event.target as HTMLElement | null)?.matches?.('input, textarea, [contenteditable]')) return;
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
    if (next && !jobsLocked) selectFile(next.id);
  }

  function selectFile(id: string) {
    if (selected?.id !== id) setExportWarnings([]);
    setSelectedId(id);
  }

  function renameFile(entry: Entry, baseName: string) {
    updateEntry(entry.id, { baseName, exportError: undefined });
    setDownload(undefined);
    setNotice('');
    setExportError('');
    setExportWarnings([]);
    setFileAnnouncement(`Renamed to ${baseName}${fileExtension(entry)}.`);
  }

  function moveFile(id: string, destination: number) {
    const index = entries.findIndex(entry => entry.id === id);
    if (jobsLocked || index < 0 || destination < 0 || destination >= entries.length || index === destination) return;
    const moved = entries[index];
    setEntries(current => {
      const next = current.filter(entry => entry.id !== id);
      const currentEntry = current.find(entry => entry.id === id);
      if (!currentEntry) return current;
      next.splice(destination, 0, currentEntry);
      return next;
    });
    setDownload(undefined);
    setNotice('');
    setExportError('');
    setExportWarnings([]);
    setFileAnnouncement(`${fileName(moved)} moved to position ${destination + 1} of ${entries.length}.`);
  }

  function targetAt({ x, y }: { x: number; y: number }) {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-file-id]')?.dataset.fileId;
  }

  function dragFile(id: string, x: number, y: number) {
    dragPosition.current = { id, x, y };
    if (dragFrame.current) return;
    const update = () => {
      dragFrame.current = 0;
      const point = dragPosition.current;
      const strip = fileStrip.current;
      if (!point || !strip) return;
      const bounds = strip.getBoundingClientRect();
      const direction = point.x < bounds.left + 24 ? -1 : point.x > bounds.right - 24 ? 1 : 0;
      const offset = strip.scrollLeft;
      if (direction && point.y >= bounds.top && point.y <= bounds.bottom) strip.scrollLeft += 6 * direction;
      const target = targetAt(point);
      setFileDrag(previous => previous?.id === point.id && previous.target === target ? previous : { id: point.id, target });
      if (strip.scrollLeft !== offset) dragFrame.current = requestAnimationFrame(update);
    };
    dragFrame.current = requestAnimationFrame(update);
  }

  function finishFileDrag(commit: boolean) {
    const point = dragPosition.current;
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    dragPosition.current = null;
    setFileDrag(undefined);
    if (commit && point) moveFile(point.id, entries.findIndex(entry => entry.id === targetAt(point)));
  }

  useEffect(() => () => cancelAnimationFrame(dragFrame.current), []);

  function startExport(kind: ExportJob['kind'], files: readonly Entry[], direct = false) {
    setDownload(undefined);
    setNotice('');
    setExportError('');
    setExportWarnings(files.flatMap(({ info }) => info?.hasAlpha && !outputFormats[info.output.format].alpha
      ? [transparencyWarning(info.output)] : []));
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
              {previewUrl && <Toggle size="sm" variant="outline" pressed={Boolean(comparing && selected?.stack.cursor)}
                disabled={!previewIsCurrent || !selected?.stack.cursor || jobsLocked}
                onPressedChange={setComparing} aria-label="Compare">
                <Columns2 aria-hidden /> Compare
              </Toggle>}
            {entries.length > 1 && (
              <div className="preview-navigation">
                <Button variant="ghost" size="icon-sm" aria-label="Previous image" title="Previous image" disabled={selectionIndex <= 0 || jobsLocked} onClick={() => selectAdjacent(-1)}>
                  <ChevronLeft size={19} aria-hidden />
                </Button>
                <span>{selectionIndex + 1} / {entries.length}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Next image" title="Next image" disabled={selectionIndex >= entries.length - 1 || jobsLocked} onClick={() => selectAdjacent(1)}>
                  <ChevronRight size={19} aria-hidden />
                </Button>
              </div>
            )}
            </div>
          </div>
          <div
            ref={setStage}
            className={`preview-stage ${previewUrl ? 'checkerboard is-loaded' : ''} ${comparisonUrl ? 'is-comparing' : ''} ${viewport.panning ? 'is-panning' : ''}`}
            aria-busy={Boolean(selected && selected.id === work?.id)}
            data-zoom={viewport.view.scale}
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
              <div ref={setPreviewTarget} className="preview-plane" style={{
                transform: viewport.view.scale === 1 && viewport.view.x === 0 && viewport.view.y === 0
                  ? undefined : `translate(${viewport.view.x}px, ${viewport.view.y}px) scale(${viewport.view.scale})`,
              }}>
                <ImageComparison name={fileName(selected)} editedUrl={previewUrl} originalUrl={comparisonUrl}
                  width={shownPreview.result.info.width} height={shownPreview.result.info.height}
                  position={split} onPositionChange={setSplit} />
              </div>
            )}
            {selected && !previewUrl && selected.status === 'paused' && (
              <div className="empty-state">
                <p>Preview canceled.</p>
                <Button variant="outline" onClick={() => updateEntry(selected.id, { status: 'pending' })}>Retry preview</Button>
              </div>
            )}
            {selected && !previewUrl && selected.status === 'error' && <p className="preview-error">Could not open image.</p>}
            {selected && !previewUrl && selected.status !== 'error' && selected.status !== 'paused' && (
              <p>Preparing image…</p>
            )}
            {selected && previewUrl && selected.status === 'paused' && (
              <Button variant="outline" className="retry-overlay" onClick={() => updateEntry(selected.id, { status: 'pending' })}>Retry preview</Button>
            )}
          </div>
          {comparisonPending && <JobProgress label="Comparison progress"
            update={{ message: 'Preparing the original preview', step: 1, totalSteps: 1 }} />}
          {previewUrl && <div className="preview-footer">
            {selected && selectedInfo && <div className="preview-facts">
              <p><span className="preview-dimensions">{formatDimensions(selectedInfo)}</span> · {formatBytes(selected.stack.original.size)}</p>
              <ImageDetails info={selectedInfo} />
            </div>}
            {previewUrl && <div className="zoom-controls" role="group" aria-label="Preview zoom">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out" onClick={() => viewport.zoom(0.8)}><Minus aria-hidden /></Button>
              <output aria-label="Zoom percentage">{viewport.percent}%</output>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in" onClick={() => viewport.zoom(1.25)}><Plus aria-hidden /></Button>
              <Button type="button" variant="outline" size="sm" aria-pressed={viewport.atFit} onClick={viewport.reset}>Fit</Button>
              <Button type="button" variant="outline" size="sm" aria-pressed={viewport.atActualSize} onClick={viewport.actual}>100%</Button>
            </div>}
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
          </div>}
        </Card>

        <Card className="workspace-card file-panel" role="region" aria-labelledby="files-title">
          <div className="panel-heading"><h2 id="files-title">Files</h2><span className="file-count">{entries.length}</span></div>
          {entries.length === 0 ? <p className="section-note">Added images appear here.</p> : (
            <>
            {entries.length > 1 && <p className="section-note">Drag thumbnails to reorder.</p>}
            <ul ref={fileStrip} className="file-list" aria-label="Added files" data-touch={isMobileDevice() || undefined} tabIndex={jobsLocked ? 0 : undefined}>
              {entries.map((entry, index) => {
                const applying = toolBusy && entry.id === activeId;
                const processing = applying || entry.id === exportProgress?.id || entry.id === work?.id;
                const status = entry.id === exportProgress?.id ? exportProgress.stage
                  : entry.id === work?.id ? previewProgress?.id === entry.id ? previewProgress.stage : 'Checking'
                  : applying ? 'Applying edit'
                  : entry.exportError ? 'Export failed'
                  : entry.status === 'ready' ? 'Ready' : entry.status === 'pending' ? 'Queued'
                  : entry.status === 'paused' ? 'Canceled' : 'Could not open';
                return <FileTile key={entry.id} id={entry.id} name={fileName(entry)} thumbnail={entry.thumbnail}
                  baseName={entry.baseName ?? originalBaseName(entry.stack.original.name)} extension={fileExtension(entry)}
                  canMoveLeft={index > 0} canMoveRight={index < entries.length - 1}
                  dragSource={fileDrag?.id === entry.id} dropTarget={fileDrag?.target === entry.id && fileDrag.id !== entry.id}
                  onDrag={(x, y) => dragFile(entry.id, x, y)} onDragEnd={finishFileDrag}
                  onMove={direction => moveFile(entry.id, index + direction)} onRename={name => renameFile(entry, name)}
                  selected={entry.id === selected?.id} processing={processing} status={status}
                  error={entry.error || entry.exportError} ready={entry.status === 'ready'} disabled={jobsLocked}
                  onSelect={() => selectFile(entry.id)} onRemove={() => remove(entry)}
                  onDownload={() => startExport('image', [entry], true)} />;
              })}
              <li className="add-tile">
                <Button variant="outline" aria-label="Add more images" title="Add more images" disabled={jobsLocked} onClick={() => picker.current?.click()}>
                  <Plus aria-hidden />
                </Button>
              </li>
            </ul>
            </>
          )}
          <p className="sr-only" role="status">{fileAnnouncement}</p>
        </Card>

        <aside className="workspace-sidebar" aria-label="Editing and export">
          <Card className="workspace-card settings-panel" role="region" aria-labelledby="tools-title">
            <div className="panel-heading"><h2 id="tools-title">Tools</h2></div>
            <ToolPanel registry={imageTools} disabled={toolsDisabled} onBusyChange={setToolBusy}
              session={selected && selectedInfo ? {
                revision: selected.stack,
                context: {
                  original: selected.stack.original, editKey, aiResults, releaseImageMemory: () => client.releaseFullPreview(),
                  originalFormat: selectedInfo.format, output: selectedInfo.output, estimator,
                  hasAlpha: selectedInfo.hasAlpha, size: selectedInfo, previewUrl, previewBlob: shownPreview?.result.blob,
                  previewTarget, setDraftSize, renderDraft, preparePreview, upscale: selectedInfo.upscale, disabled: toolsDisabled,
                },
                initialOptions: {
                  ...Object.fromEntries(activeCommands(selected.stack)
                    .filter(command => imageTools.get(command.toolId).rememberOptions)
                    .map(command => [command.toolId, command.options])),
                  convert: selectedInfo.conversion,
                },
                onApply: (command: EditCommand) => edit(selected, recordEdit(selected.stack, command)),
              } : undefined} />
          </Card>

          <Card className="workspace-card export-panel" role="region" aria-labelledby="export-title">
            <div className="panel-heading"><h2 id="export-title">Export</h2></div>
            <div className="export-content">
              {selectedInfo && <>
                <p className="output-summary">
                  {outputFormats[selectedInfo.output.format].label}
                  {outputFormats[selectedInfo.output.format].lossy && ` · Quality ${selectedInfo.output.quality}%`}
                </p>
                <p className="section-note">
                  {selectedInfo.output.format === 'ico'
                    ? formatIconDimensions(selectedInfo.output.iconSizes ?? iconSizes)
                    : formatDimensions(selectedInfo)}
                </p>
                <OutputEstimate estimator={estimator} preview={shownPreview?.result.blob} output={selectedInfo.output}
                  size={selectedInfo} paused={!previewIsCurrent || jobsLocked} />
              </>}
              {selected && selectedInfo?.hasAlpha && !outputFormats[selectedInfo.output.format].alpha && (
                <ColorField label="Fill transparent areas with" value={selectedInfo.output.background} disabled={toolsDisabled}
                  onChange={background => edit(selected, recordEdit(selected.stack, {
                    toolId: 'convert', options: { ...selectedInfo.conversion, background },
                  }))} />
              )}
              {warnings.length > 0 && (
                <Notice variant="warning" announce={false}
                  onDismiss={() => setDismissedWarnings(previous => new Set([...previous, ...warnings]))}>
                  {warnings.map(warning => <p key={warning}>{warning}</p>)}
                </Notice>
              )}
              {completed.length > 0 ? <>
              <p className="section-note">Uses original pixels. Removes EXIF metadata.</p>
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
              </> : !work && <p className="section-note">Add an image to export it.</p>}
              {exportJob ? <JobProgress update={exportJobProgress(exportJob.kind === 'zip', exportProgress)}
                label="Export progress" statusClass="job-status"
                file={exportProgress ?? { index: 1, total: exportJob.entries.length }} />
                : work ? <JobProgress key={work.id} update={previewJob(activeCommands(work.stack).some(command => command.toolId === 'upscale'),
                    previewProgress?.id === work.id ? previewProgress : undefined)}
                  label="Preview progress" statusClass="job-status" />
                : <p className="job-status" role="status">{notice}</p>}
              {exportError && <Notice variant="error" onDismiss={() => setExportError('')}>{exportError}</Notice>}
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
