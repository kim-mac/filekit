import type { EditCommand } from '../../core/contracts';
import { defaultImageLayout, type ImageLayout, type PageSize } from './layout';
import type { FormValue, Overlay } from './overlay';

interface PageBase {
  readonly id: string;
  readonly rotation: number;
  readonly objects?: readonly Overlay[];
  readonly fields?: Readonly<Record<string, FormValue>>;
}

export type PageRef =
  | (PageBase & { readonly kind: 'pdf'; readonly source: string; readonly index: number })
  | (PageBase & { readonly kind: 'image'; readonly source: string; readonly layout: ImageLayout })
  | (PageBase & { readonly kind: 'blank'; readonly size: PageSize });

export type PageOperation =
  | { kind: 'move'; ids: string[]; target: string; after: boolean }
  | { kind: 'rotate'; ids: string[]; clockwise: -90 | 90 | 180 }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'duplicate'; ids: string[]; newIds: string[] }
  | { kind: 'insert'; after?: string; pages: PageRef[] }
  | { kind: 'overlay'; id: string; objects: readonly Overlay[] }
  | { kind: 'form'; id: string; name: string; value: FormValue }
  | { kind: 'layout'; ids: string[]; layout: ImageLayout };

export const rotationDegrees = (rotation: number) => (rotation % 360 + 360) % 360;

export function pageRenderKey(page: PageRef) {
  if (page.kind === 'pdf') return `${page.source}:${page.index}:${page.rotation}`;
  if (page.kind === 'image') return JSON.stringify([page.source, page.rotation, page.layout]);
  return JSON.stringify([page.rotation, page.size]);
}

export function pdfPages(source: string, count: number): PageRef[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${source}:${index}`, kind: 'pdf', source, index, rotation: 0 }));
}

export function imagePage(source: string): PageRef {
  return { id: `${source}:0`, kind: 'image', source, layout: defaultImageLayout, rotation: 0 };
}

export function applyPageOperation(pages: readonly PageRef[], operation: PageOperation): PageRef[] {
  if (operation.kind === 'overlay') {
    return pages.map(page => page.id === operation.id ? { ...page, objects: operation.objects } : page);
  }
  if (operation.kind === 'form') {
    const target = pages.find(page => page.id === operation.id);
    return pages.map(page => target?.kind === 'pdf' && page.kind === 'pdf' && page.source === target.source
      ? { ...page, fields: { ...page.fields, [operation.name]: operation.value } } : page);
  }
  if (operation.kind === 'insert') {
    const index = operation.after === undefined ? pages.length : pages.findIndex(page => page.id === operation.after) + 1;
    return [...pages.slice(0, index), ...operation.pages, ...pages.slice(index)];
  }
  const ids = new Set(operation.ids);
  switch (operation.kind) {
    case 'rotate':
      return pages.map(page => ids.has(page.id) ? { ...page, rotation: rotationDegrees(page.rotation + operation.clockwise) } : page);
    case 'delete': {
      const remaining = pages.filter(page => !ids.has(page.id));
      if (!remaining.length) throw new Error('Keep at least one page in the PDF.');
      return remaining;
    }
    case 'duplicate': {
      let index = 0;
      return pages.flatMap(page => ids.has(page.id) ? [page, { ...page, id: operation.newIds[index++] }] : [page]);
    }
    case 'move': {
      if (ids.has(operation.target)) return [...pages];
      const moving = pages.filter(page => ids.has(page.id));
      const remaining = pages.filter(page => !ids.has(page.id));
      const index = remaining.findIndex(page => page.id === operation.target);
      if (index < 0) return [...pages];
      const position = index + Number(operation.after);
      return [...remaining.slice(0, position), ...moving, ...remaining.slice(position)];
    }
    case 'layout':
      return pages.map(page => page.kind === 'image' && ids.has(page.id) ? { ...page, layout: operation.layout } : page);
  }
}

export function replayPages(pages: readonly PageRef[], commands: readonly EditCommand[]): readonly PageRef[] {
  return commands.reduce((current, command) => applyPageOperation(current, command.options as PageOperation), pages);
}
