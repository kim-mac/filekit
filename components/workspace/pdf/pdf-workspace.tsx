'use client';

import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, FilePlus2, FileText, Redo2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditCommand, ToolProgress } from '../../../lib/core/contracts';
import { isMobileDevice } from '../../../lib/core/device';
import { activeCommands, redo, undo } from '../../../lib/core/edit-stack';
import { isMemoryError } from '../../../lib/core/processing-error';
import { formatBytes } from '../../../lib/tools/image/size-estimate';
import { pdfTools, type PdfToolContext } from '../../../lib/tools/pdf';
import { type PageOperation, type PageRef } from '../../../lib/tools/pdf/pages';
import { PdfWorkerClient } from '../../../lib/workers/pdf/client';
import type { ExportResult, RasterOptions } from '../../../lib/workers/pdf/types';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { JobProgress } from '../../ui/job-progress';
import { Notice } from '../../ui/notice';
import { FilesStrip } from '../files-strip';
import { ToolPanel } from '../tool-panel';
import { useObjectUrl } from '../use-object-url';
import { WorkspaceShell } from '../workspace-shell';
import { PageGrid } from './page-grid';
import { PasswordDialog } from './password-dialog';
import { PdfDetails } from './pdf-details';
import { SinglePage } from './single-page';
import { documentBaseName, documentName, documentPages, usePdfDocuments, type PdfEntry } from './use-pdf-documents';

const accepted = '.pdf,.jpg,.jpeg,.png,.webp,.avif,.gif,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif';
const emptyPages: readonly PageRef[] = [];
const pageCount = (count: number) => `${count} ${count === 1 ? 'page' : 'pages'}`;
const exportStart = { message: 'Preparing export', step: 1, totalSteps: 2 };
const uniquePages = (pages: readonly PageRef[]) => pages.map(page => ({ ...page, id: crypto.randomUUID() }));

interface Selection { document: string; ids: Set<string>; anchor: string; focus: string }
interface Download extends ExportResult { document: string; direct: boolean; pdf: boolean }

export function PdfWorkspace() {
  const [device, setDevice] = useState<'desktop' | 'mobile'>();
  useEffect(() => setDevice(isMobileDevice() ? 'mobile' : 'desktop'), []);
  const mobile = device === 'mobile';
  const documents = usePdfDocuments(mobile);
  const { entries, selected, work, sources } = documents;
  const [exporter] = useState(() => new PdfWorkerClient());
  const [exporting, setExporting] = useState<{ id: string; progress: ToolProgress }>();
  const exportToken = useRef<object>(undefined);
  const [download, setDownload] = useState<Download>();
  const [notice, setNotice] = useState<{ type: 'info' | 'error' | 'warning'; text: string }>();
  const [announcement, setAnnouncement] = useState('');
  const [strip, setStrip] = useState(false);
  const [view, setView] = useState<'grid' | 'single'>('grid');
  const [multi, setMulti] = useState(false);
  const [selection, setSelection] = useState<Selection>();
  const [dragTarget, setDragTarget] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  const fileStrip = useRef<HTMLUListElement>(null);
  const emptyPicker = useRef<HTMLButtonElement>(null);
  const save = useRef<HTMLAnchorElement>(null);
  const url = useObjectUrl(download?.blob);
  const ready = selected?.status === 'ready';
  const locked = Boolean(exporting);
  const activeId = selected?.id;
  const openFiles = useMemo(() => entries.filter(entry => entry.status === 'ready').map(entry => ({
    id: entry.id, name: documentName(entry), image: entry.kind === 'image', primary: entry.primary, pages: documentPages(entry),
  })), [entries]);
  const pages = openFiles.find(file => file.id === activeId)?.pages ?? emptyPages;
  const first = pages[0]?.id;
  const selectionHere = selection?.document === activeId ? selection : undefined;
  const chosen = selectionHere?.ids ?? new Set(first ? [first] : []);
  const chosenPages = pages.filter(page => chosen.has(page.id));
  const pageIndex = Math.max(0, pages.findIndex(page => page.id === (selectionHere?.focus ?? first)));
  const currentView = selectionHere ? view : 'grid';
  const { canRender } = documents;
  const context = ready && activeId
    ? { activeId, pages, selected: chosenPages, documents: openFiles, mobile, canRender } satisfies PdfToolContext : undefined;
  const primarySources = new Set(pages.flatMap(page => page.kind === 'blank' ? [] : [page.source]));
  const containsEncrypted = [...primarySources].some(source => sources.get(source)?.encrypted);
  const containsForms = [...primarySources].some(source => sources.get(source)?.forms);
  const bytes = estimateBytes(pages, sources);
  const large = pages.length >= 200 || bytes >= 64 * 1024 * 1024;

  useEffect(() => () => {
    exportToken.current = undefined;
    exporter.stop();
  }, [exporter]);
  useEffect(() => {
    if (download?.direct && url) save.current?.click();
  }, [download, url]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (locked || !selected || !ready || documents.lockedFile || !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'z' || (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable=true]')) return;
      event.preventDefault();
      changeHistory(event.shiftKey ? 'redo' : 'undo');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function clearOutput() {
    setDownload(undefined);
    setNotice(undefined);
  }

  function selectPage(id: string, range: boolean, toggle: boolean) {
    if (!activeId || locked) return;
    const index = pages.findIndex(page => page.id === id);
    const anchor = selectionHere?.anchor ?? first ?? id;
    const origin = pages.findIndex(page => page.id === anchor);
    let ids = new Set([id]);
    if (range && origin >= 0) {
      ids = new Set(pages.slice(Math.min(index, origin), Math.max(index, origin) + 1).map(page => page.id));
    } else if (toggle || multi) {
      ids = new Set(chosen);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
    }
    setSelection({ document: activeId, ids, anchor: range ? anchor : id, focus: id });
  }

  function selectAll() {
    if (!activeId || !first || locked) return;
    setSelection({ document: activeId, ids: new Set(pages.map(page => page.id)), anchor: first, focus: selectionHere?.focus ?? first });
  }

  function focusPage(index: number) {
    const id = pages[index]?.id;
    if (!activeId || !id) return;
    setSelection({ document: activeId, ids: new Set([id]), anchor: id, focus: id });
  }

  function selectFile(entry: PdfEntry) {
    if (entry.id !== activeId) {
      clearOutput();
      setSelection(undefined);
      setView('grid');
    }
    documents.select(entry);
  }

  function changeHistory(action: 'undo' | 'redo') {
    if (!selected || locked) return;
    const stack = action === 'undo' ? undo(selected.stack) : redo(selected.stack);
    if (stack !== selected.stack) {
      documents.setEntry(selected.id, { stack });
      clearOutput();
      setAnnouncement(action === 'undo' ? 'Undid page edit.' : 'Redid page edit.');
    }
  }

  function edit(operation: PageOperation, message: string, id = activeId, tool = 'organize') {
    if (!id || locked) return;
    documents.edit(id, operation, tool);
    clearOutput();
    setAnnouncement(message);
  }

  function movePage(id: string, target: string, after: boolean) {
    if (!activeId || id === target || locked) return;
    const ids = chosen.has(id) ? chosenPages.map(page => page.id) : [id];
    if (ids.includes(target)) return;
    setSelection({ document: activeId, ids: new Set(ids), anchor: id, focus: id });
    edit({ kind: 'move', ids, target, after }, `Moved ${pageCount(ids.length)}.`);
  }

  function nudge(direction: -1 | 1) {
    const moving = chosenPages.map(page => pages.indexOf(page));
    const from = direction < 0 ? moving[0] : moving.at(-1);
    if (from === undefined) return;
    const target = pages[from + direction];
    if (target) movePage(pages[from].id, target.id, direction > 0);
  }

  function insertPage(id: string, target: string) {
    if (target === activeId || !openFiles.some(file => file.id === target && !file.image)) return;
    const copies = uniquePages(chosen.has(id) ? chosenPages : pages.filter(page => page.id === id));
    edit({ kind: 'insert', pages: copies }, `Copied ${pageCount(copies.length)} to ${openFiles.find(file => file.id === target)?.name}.`, target, 'merge');
  }

  async function useTool(command: EditCommand) {
    if (!context || !selected || locked) return;
    try {
      const state = await pdfTools.get(command.toolId).apply(context, command.options);
      const result = state.result;
      if (!result) return;
      if (result.kind === 'edit') edit(result.operation, result.message, result.target ?? activeId, command.toolId);
      if (result.kind === 'document') {
        documents.addDocument(result.name, result.pages, result.primary);
        setSelection(undefined);
        setView('grid');
        clearOutput();
        setAnnouncement(`Created ${result.name}.pdf with ${pageCount(result.pages.length)}.`);
      }
      if (result.kind === 'output') void startExport(selected, result);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'This PDF operation failed. Try again.' });
    }
  }

  function cancelExport() {
    exportToken.current = undefined;
    exporter.stop();
    setExporting(undefined);
    setNotice({ type: 'info', text: 'Export canceled.' });
  }

  async function startExport(entry: PdfEntry, options?: {
    groups: number[][]; archive?: boolean; suffix?: string; raster?: RasterOptions;
  }, direct = false) {
    if (entry.status !== 'ready' || exportToken.current) return;
    const final = documentPages(entry);
    const groups = options?.groups ?? [final.map((_, index) => index)];
    const ids = new Set(entry.primary ? [entry.primary] : []);
    for (const group of groups) {
      for (const index of group) {
        const page = final[index];
        if (page.kind !== 'blank') ids.add(page.source);
      }
    }
    const input = Object.fromEntries([...ids].map(id => [id, sources.get(id)!.blob]));
    const token = {};
    exportToken.current = token;
    clearOutput();
    setExporting({ id: entry.id, progress: exportStart });
    try {
      const result = await exporter.export({
        baseName: documentBaseName(entry) + (options?.suffix ?? ''), sources: input,
        primary: entry.primary, strip, initial: entry.initial, commands: activeCommands(entry.stack), groups,
        archive: options?.archive,
        raster: options?.raster && { ...options.raster, mobile, pageNumbers: groups.map(([index]) => index + 1) },
      }, progress => {
        if (exportToken.current === token) setExporting({ id: entry.id, progress });
      });
      if (exportToken.current !== token) return;
      setDownload({ ...result, document: entry.id, direct, pdf: !options });
      if (result.limited) setNotice({ type: 'warning', text: 'Some images reached the mobile size limit and were exported at a lower effective DPI.' });
    } catch (error) {
      if (exportToken.current === token) {
        const message = isMemoryError(error) ? 'This device ran out of memory. Try fewer pages, a lower DPI, or a desktop.'
          : error instanceof Error && /too large at the selected DPI|PDF worker stopped/.test(error.message) ? error.message
          : 'Could not export this PDF. Try fewer pages or open the original in another PDF reader.';
        setNotice({ type: 'error', text: message });
      }
    } finally {
      if (exportToken.current === token) {
        exportToken.current = undefined;
        exporter.stop();
        setExporting(undefined);
      }
    }
  }

  return (
    <WorkspaceShell title="PDF" description="Organize and export PDF pages on your device." icon={FileText}
      locked={locked || !device} onFiles={documents.addFiles} picker={<input ref={picker} aria-label="PDF and image files" type="file"
        multiple accept={accepted} disabled={locked || !device} hidden onChange={event => {
          documents.addFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }} />}>
      <Card className="workspace-card preview-panel pdf-preview" role="region" aria-labelledby="preview-title">
        <div className="panel-heading">
          <h2 id="preview-title">Preview</h2>
          {ready && <div className="preview-controls">
            <Button type="button" size="sm" variant="outline" aria-pressed={currentView === 'grid'}
              onClick={() => setView('grid')}>Page grid</Button>
            <Button type="button" size="sm" variant="outline" aria-pressed={currentView === 'single'} disabled={!canRender} onClick={() => {
              if (!selectionHere) focusPage(pageIndex);
              setView('single');
            }}>Single page</Button>
          </div>}
        </div>
        {!selected && <div className="preview-stage">
          <button ref={emptyPicker} type="button" className="empty-state empty-picker" disabled={!device} onClick={() => picker.current?.click()}>
            <span className="empty-icon"><FilePlus2 size={30} aria-hidden /></span>
            <strong>Drop PDFs or images here</strong><span><b>Choose files</b> from your device</span>
            <small>PDF, JPG, PNG, WebP, AVIF, GIF, HEIC</small>
          </button>
        </div>}
        {selected && !ready && <div className="preview-stage">
          {selected.status === 'queued' && <p className="section-note" role="status">Opening {documentName(selected)}…</p>}
          {selected.status === 'error' && <Button variant="outline" onClick={() => picker.current?.click()}>Choose another file</Button>}
          {selected.status === 'locked' && <Button variant="outline" onClick={() => documents.select(selected)}>Enter password</Button>}
        </div>}
        {context && currentView === 'grid' && <>
          <div className="pdf-actions pdf-selection" role="group" aria-label="Page selection">
            <span role="status">{chosenPages.length} selected</span>
            <Button type="button" size="sm" variant="ghost" disabled={locked || chosenPages.length === pages.length} onClick={selectAll}>Select all pages</Button>
            {mobile && <Button type="button" size="sm" variant="outline" aria-pressed={multi} onClick={() => setMulti(!multi)}>Multi-select</Button>}
            <div className="pdf-move">
              <Button aria-label="Move selected pages earlier" title="Move selected pages earlier" variant="ghost" size="icon"
                disabled={locked || !chosenPages.length || chosenPages[0] === pages[0]} onClick={() => nudge(-1)}><ArrowLeft aria-hidden /></Button>
              <Button aria-label="Move selected pages later" title="Move selected pages later" variant="ghost" size="icon"
                disabled={locked || !chosenPages.length || chosenPages.at(-1) === pages.at(-1)} onClick={() => nudge(1)}><ArrowRight aria-hidden /></Button>
            </div>
          </div>
          <PageGrid key={activeId} pages={pages} selected={chosen} locked={locked} render={canRender ? documents.render : undefined}
            onSelect={selectPage} onSelectAll={selectAll} onOpen={id => {
              if (!canRender) return;
              focusPage(pages.findIndex(page => page.id === id));
              setView('single');
            }} onMove={movePage} onInsert={insertPage} onFileTarget={setDragTarget} />
          <p className="section-note">Drag by the handle or use Alt + arrow keys.{openFiles.length > 1 && ' Drop onto another PDF to copy pages.'}</p>
        </>}
        {context && currentView === 'single' && pages[pageIndex] && <>
          <div className="preview-navigation pdf-page-navigation">
            <Button variant="ghost" size="icon" aria-label="Previous page" title="Previous page"
              disabled={pageIndex === 0} onClick={() => focusPage(pageIndex - 1)}><ChevronLeft aria-hidden /></Button>
            <span>{pageIndex + 1} / {pages.length}</span>
            <Button variant="ghost" size="icon" aria-label="Next page" title="Next page"
              disabled={pageIndex + 1 === pages.length} onClick={() => focusPage(pageIndex + 1)}><ChevronRight aria-hidden /></Button>
          </div>
          <SinglePage page={pages[pageIndex]} number={pageIndex + 1} render={documents.render} />
        </>}
        {ready && selected && <div className="preview-footer">
          <div className="preview-facts"><span>{pageCount(pages.length)}</span>{pages[pageIndex] &&
            <PdfDetails entry={selected} count={pages.length} page={pages[pageIndex]}
              getSize={documents.size} bytes={selected.stack.original.size || undefined} />}</div>
          <div className="history-buttons" role="group" aria-label="Edit history">
            <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (Ctrl/⌘ Z)"
              disabled={locked || selected.stack.cursor === 0} onClick={() => changeHistory('undo')}><Undo2 aria-hidden /></Button>
            <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)"
              disabled={locked || selected.stack.cursor === selected.stack.commands.length} onClick={() => changeHistory('redo')}><Redo2 aria-hidden /></Button>
          </div>
        </div>}
        {large && <Notice announce={false}>Large document. Thumbnails load as you scroll. Exports can take longer on this device.</Notice>}
        {ready && !canRender && <Notice variant="warning">Page previews are unavailable in this browser. You can still organize and export PDFs.</Notice>}
      </Card>

      <FilesStrip listRef={fileStrip} locked={locked} onAdd={() => picker.current?.click()} addLabel="Add more PDFs or images"
        empty="Added PDFs and images appear here." externalTarget={dragTarget && openFiles.some(file => file.id === dragTarget && !file.image && file.id !== activeId) ? dragTarget : undefined}
        onMove={(id, index) => {
          documents.move(id, index);
          clearOutput();
          if (index >= 0 && index < entries.length) setAnnouncement(`Moved file to position ${index + 1}.`);
        }}
        announcement={announcement} tiles={entries.map(entry => {
          const count = openFiles.find(file => file.id === entry.id)?.pages.length ?? 0;
          const index = entries.indexOf(entry);
          const processing = exporting?.id === entry.id || work?.id === entry.id;
          const status = exporting?.id === entry.id ? 'Exporting…' : processing ? 'Opening…'
            : entry.status === 'ready' ? pageCount(count) : entry.status === 'locked' ? 'Password required'
              : entry.status === 'queued' ? 'Queued' : 'Could not open';
          return {
            id: entry.id, name: documentName(entry), baseName: documentBaseName(entry), extension: '.pdf', thumbnail: entry.thumbnail,
            fallbackIcon: entry.kind === 'image' ? undefined : FileText,
            selected: entry.id === activeId, status, processing, error: entry.error, disabled: locked, ready: entry.status === 'ready',
            onSelect: () => selectFile(entry), onRemove: () => {
              const next = entries[index + 1] ?? entries[index - 1];
              documents.remove(entry.id);
              clearOutput();
              setAnnouncement(`Removed ${documentName(entry)}.`);
              requestAnimationFrame(() => {
                const target = next && fileStrip.current?.querySelector<HTMLButtonElement>(`[data-file-id="${next.id}"] .select-file`);
                (target || emptyPicker.current)?.focus();
              });
            },
            onRename: name => {
              documents.setEntry(entry.id, { baseName: name });
              clearOutput();
              setAnnouncement(`Renamed to ${name}.pdf.`);
            },
            onDownload: () => void startExport(entry, undefined, true),
          };
        })} />

      <aside className="workspace-sidebar" aria-label="Editing and export">
        <Card className="workspace-card settings-panel" role="region" aria-labelledby="tools-title">
          <div className="panel-heading"><h2 id="tools-title">Tools</h2></div>
          <ToolPanel registry={pdfTools} disabled={locked} emptyMessage="Add a PDF or image to start."
            session={selected && context ? {
              revision: selected.stack, context, initialOptions: {}, onApply: command => { void useTool(command); },
            } : undefined} />
        </Card>
        <Card className="workspace-card export-panel" role="region" aria-labelledby="export-title">
          <div className="panel-heading"><h2 id="export-title">Export</h2></div>
          <div className="export-content">
            {context && selected ? <>
              <p className="output-summary">{documentBaseName(selected)}.pdf</p>
              <p className="section-note">{pageCount(pages.length)} · {download?.pdf && download.document === activeId
                ? formatBytes(download.blob.size) : `≈ ${formatBytes(bytes)} estimated`}</p>
              <label className="pdf-checkbox">
                <input type="checkbox" checked={strip} disabled={locked} onChange={event => {
                  setStrip(event.target.checked);
                  clearOutput();
                }} /> Remove PDF metadata
              </label>
              {containsEncrypted && <Notice variant="warning" announce={false}>The exported PDF will open without a password.</Notice>}
              {containsForms && <Notice announce={false}>Copied or extracted form pages may lose interactive fields. Field appearances are kept where available.</Notice>}
              <Button disabled={locked} onClick={() => void startExport(selected)}><ArrowDownToLine aria-hidden /> Export PDF</Button>
            </> : <p className="section-note">Open a file to export it.</p>}
            {work && !documents.lockedFile && !exporting && <JobProgress label="Open progress" update={work.progress} />}
            {exporting && <>
              <JobProgress label="Export progress" update={exporting.progress} />
              <Button variant="outline" onClick={cancelExport}>Cancel export</Button>
            </>}
            {notice && <Notice variant={notice.type} onDismiss={() => setNotice(undefined)}>{notice.text}</Notice>}
            {download && url && <Button asChild variant="secondary">
              <a ref={save} href={url} download={download.name}><Check aria-hidden /> Save to device</a>
            </Button>}
          </div>
        </Card>
      </aside>
      <PasswordDialog name={documents.lockedFile && documentName(documents.lockedFile)} error={documents.passwordError}
        unlocking={documents.unlocking} progress={work?.id === documents.lockedFile?.id ? work?.progress : undefined}
        onClose={documents.closePassword} onUnlock={password => void documents.unlock(password)} />
    </WorkspaceShell>
  );
}

function estimateBytes(pages: readonly PageRef[], sources: ReadonlyMap<string, { size: number; pages: number }>) {
  let bytes = 700;
  const counted = new Set<string>();
  for (const page of pages) {
    bytes += 96;
    if (page.kind === 'blank') continue;
    const key = page.kind === 'pdf' ? `${page.source}:${page.index}` : page.source;
    if (counted.has(key)) continue;
    counted.add(key);
    const source = sources.get(page.source);
    if (source) bytes += source.size / source.pages;
  }
  return Math.round(bytes);
}
