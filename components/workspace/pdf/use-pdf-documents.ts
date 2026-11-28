import { useCallback, useEffect, useRef, useState } from 'react';
import { activeCommands, createEditStack, recordEdit, type EditStack } from '../../../lib/core/edit-stack';
import { originalBaseName } from '../../../lib/core/file-name';
import type { ToolProgress } from '../../../lib/core/contracts';
import { imagePage, pdfPages, replayPages, type PageOperation, type PageRef } from '../../../lib/tools/pdf/pages';
import { PdfWorkerClient } from '../../../lib/workers/pdf/client';
import type { IntakeResult, PdfDetails } from '../../../lib/workers/pdf/types';

export interface PdfEntry {
  readonly id: string;
  readonly kind: 'pdf' | 'image' | 'draft';
  readonly stack: EditStack;
  readonly initial: readonly PageRef[];
  readonly status: 'queued' | 'ready' | 'locked' | 'error';
  readonly baseName?: string;
  readonly primary?: string;
  readonly details?: PdfDetails;
  readonly thumbnail?: Blob;
  readonly error?: string;
}

export const documentBaseName = (entry: PdfEntry) => entry.baseName ?? originalBaseName(entry.stack.original.name, 'document');
export const documentName = (entry: PdfEntry) => entry.baseName ? `${entry.baseName}.pdf` : entry.stack.original.name;
export const documentPages = (entry: PdfEntry) => replayPages(entry.initial, activeCommands(entry.stack));
const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

const openError = (kind: PdfEntry['kind'], error: unknown) => error instanceof Error && kind === 'pdf' ? error.message
  : 'This image could not be opened. Choose a supported JPG, PNG, WebP, AVIF, GIF, or HEIC file.';

interface LocalSource { blob: Blob; size: number; pages: number; forms: boolean; encrypted: boolean }

export function usePdfDocuments(mobile: boolean) {
  const [client] = useState(() => new PdfWorkerClient());
  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [work, setWork] = useState<{ id: string; progress: ToolProgress }>();
  const [passwordId, setPasswordId] = useState<string>();
  const [passwordError, setPasswordError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [canRender, setCanRender] = useState(true);
  const sources = useRef(new Map<string, LocalSource>());
  const live = useRef(false);
  const canUnlock = useRef(true);
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];
  const pending = entries.find(entry => entry.status === 'queued');
  const pendingId = pending?.id;
  const pendingKind = pending?.kind;
  const pendingFile = pending?.stack.original;
  const lockedFile = entries.find(entry => entry.id === passwordId);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      client.stop();
    };
  }, [client]);

  function setEntry(id: string, patch: Partial<PdfEntry>) {
    setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
  }

  const accept = useCallback((result: IntakeResult, id: string, file: File) => {
    if (result.kind === 'password') {
      setEntry(id, { status: 'locked' });
      setPasswordId(current => current ?? id);
      return;
    }
    const details = result.kind === 'pdf' ? result.details : undefined;
    setCanRender(result.canRender);
    const count = details?.count ?? 1;
    sources.current.set(id, {
      blob: result.kind === 'pdf' ? result.unlocked ?? file : file,
      size: file.size, pages: count, forms: Boolean(details?.forms), encrypted: Boolean(details?.encrypted),
    });
    setEntry(id, {
      status: 'ready', initial: result.kind === 'pdf' ? pdfPages(id, count) : [imagePage(id)],
      primary: result.kind === 'pdf' ? id : undefined, details,
      thumbnail: result.kind === 'image' ? result.thumbnail : undefined,
    });
  }, []);

  useEffect(() => {
    if (!pendingId || !pendingFile || !pendingKind || pendingKind === 'draft' || unlocking) return;
    let current = true;
    const progress = (update: ToolProgress) => {
      if (current) setWork({ id: pendingId, progress: update });
    };
    function finish() {
      if (!current) return false;
      // Comlink progress and the result arrive on separate ports.
      current = false;
      setWork(value => value?.id === pendingId ? undefined : value);
      return true;
    }
    progress({ message: 'Opening file', step: 1, totalSteps: 3 });
    void client.inspect(pendingId, pendingFile, pendingKind, undefined, mobile, progress).then(result => {
      if (finish()) accept(result, pendingId, pendingFile);
    }, error => {
      if (finish()) setEntry(pendingId, { status: 'error', error: openError(pendingKind, error) });
    });
    return () => { current = false; };
  }, [pendingId, pendingKind, pendingFile, client, mobile, accept, unlocking]);

  useEffect(() => {
    const retained = new Set<string>();
    function retain(pages: readonly PageRef[]) {
      for (const page of pages) {
        if (page.kind !== 'blank') retained.add(page.source);
      }
    }
    for (const entry of entries) {
      // A queued intake can still be opening while another file is removed.
      retained.add(entry.id);
      if (entry.primary) retained.add(entry.primary);
      retain(entry.initial);
      for (const command of entry.stack.commands) {
        const operation = command.options as PageOperation;
        if (operation.kind === 'insert') retain(operation.pages);
      }
    }
    let removed = false;
    for (const id of sources.current.keys()) {
      if (!retained.has(id)) {
        sources.current.delete(id);
        removed = true;
      }
    }
    if (!entries.length) client.stop();
    else if (removed) client.retain([...retained]);
  }, [client, entries]);

  const render = useCallback((page: PageRef, edge: number) => {
    const source = page.kind === 'blank' ? undefined : sources.current.get(page.source)?.blob;
    return client.preview(page, source, edge, mobile);
  }, [client, mobile]);
  const size = useCallback((page: PageRef) => {
    const source = page.kind === 'blank' ? undefined : sources.current.get(page.source)?.blob;
    return client.size(page, source, mobile);
  }, [client, mobile]);
  const inspectPage = useCallback((page: PageRef) => {
    const source = page.kind === 'blank' ? undefined : sources.current.get(page.source)?.blob;
    return client.editing(page, source, mobile);
  }, [client, mobile]);
  const prepareImage = useCallback((blob: Blob, removeBackground: boolean) => client.prepareImage(blob, removeBackground), [client]);

  function addFiles(files: readonly File[]) {
    if (!files.length) return;
    const batch = files.map((file): PdfEntry => ({
      id: crypto.randomUUID(), stack: createEditStack(file), kind: isPdf(file) ? 'pdf' : 'image',
      initial: [], status: 'queued',
    }));
    setEntries(current => [...current, ...batch]);
    setSelectedId(current => current ?? entries[0]?.id ?? batch[0].id);
  }

  function select(entry: PdfEntry) {
    setSelectedId(entry.id);
    if (entry.status === 'locked') {
      setPasswordError('');
      setPasswordId(entry.id);
    }
  }

  function closePassword() {
    if (!canUnlock.current) return;
    setPasswordId(undefined);
    setPasswordError('');
  }

  async function unlock(password: string) {
    if (!lockedFile || !canUnlock.current) return;
    const { id, stack } = lockedFile;
    let acceptingProgress = true;
    canUnlock.current = false;
    setUnlocking(true);
    setPasswordError('');
    try {
      const result = await client.inspect(id, stack.original, 'pdf', password, mobile, progress => {
        if (live.current && acceptingProgress) setWork({ id, progress });
      });
      if (!live.current) return;
      if (result.kind === 'password') {
        setPasswordError('Incorrect password. Try again.');
      } else {
        accept(result, id, stack.original);
        setPasswordId(undefined);
      }
    } catch (error) {
      if (live.current) setPasswordError(openError('pdf', error));
    } finally {
      acceptingProgress = false;
      canUnlock.current = true;
      if (live.current) {
        setWork(current => current?.id === id ? undefined : current);
        setUnlocking(false);
      }
    }
  }

  function remove(id: string) {
    setEntries(current => current.filter(entry => entry.id !== id));
    if (selected?.id === id) {
      const index = entries.findIndex(entry => entry.id === id);
      setSelectedId((entries[index + 1] ?? entries[index - 1])?.id);
    }
    if (work?.id === id) setWork(undefined);
  }

  function move(id: string, to: number) {
    if (to < 0 || to >= entries.length || entries[to].id === id) return;
    setEntries(current => {
      const from = current.findIndex(entry => entry.id === id);
      if (from < 0) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }

  function edit(id: string, operation: PageOperation, toolId: string) {
    setEntries(current => current.map(entry => entry.id === id
      ? { ...entry, stack: recordEdit(entry.stack, { toolId, options: operation }) } : entry));
  }

  function addDocument(name: string, initial: readonly PageRef[], primary?: string) {
    const id = crypto.randomUUID();
    const original = new File([], `${name}.pdf`, { type: 'application/pdf' });
    const source = entries.find(entry => entry.id === primary);
    setEntries(current => [...current, {
      id, status: 'ready', kind: 'draft', stack: createEditStack(original), initial, primary,
      details: source?.details,
    }]);
    setSelectedId(id);
  }

  return {
    entries, selected, work, lockedFile, passwordError, unlocking, canRender, sources: sources.current,
    addFiles, select, closePassword, unlock, remove, move, edit, addDocument, setEntry, render, size, inspectPage, prepareImage,
  };
}
