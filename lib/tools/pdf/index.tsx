import { Combine, FileImage, Files, ImagePlus, PanelsTopLeft } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Select } from '../../../components/ui/select';
import type { ToolDefinition } from '../../core/contracts';
import { CategoryRegistry } from '../../core/registry';
import type { RasterOptions } from '../../workers/pdf/types';
import { a4, defaultImageLayout, letter, parseRanges, splitGroups, type ImageLayout } from './layout';
import type { PageOperation, PageRef } from './pages';

interface OpenDocument {
  id: string;
  name: string;
  image: boolean;
  primary?: string;
  pages: readonly PageRef[];
}

export interface PdfToolContext {
  activeId: string;
  pages: readonly PageRef[];
  selected: readonly PageRef[];
  documents: readonly OpenDocument[];
  mobile: boolean;
  canRender: boolean;
}

type ToolResult =
  | { kind: 'edit'; operation: PageOperation; target?: string; message: string }
  | { kind: 'document'; name: string; pages: readonly PageRef[]; primary?: string }
  | { kind: 'output'; groups: number[][]; archive?: boolean; raster?: RasterOptions; suffix?: string };

interface PdfToolState extends PdfToolContext { result?: ToolResult }
type PdfTool<Options> = ToolDefinition<PdfToolState, Options, PdfToolState, PdfToolContext>;

function fieldValue(input: unknown) {
  return (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function Choice({ label, ...props }: ComponentProps<typeof Select> & { label: string }) {
  return <label className="field pdf-field"><span>{label}</span><Select {...props} /></label>;
}

const ids = (pages: readonly PageRef[]) => pages.map(page => page.id);
const withNewIds = (pages: readonly PageRef[]) => pages.map(page => ({ ...page, id: crypto.randomUUID() }));
const countLabel = (count: number) => `${count} ${count === 1 ? 'page' : 'pages'}`;

const organizeActions = ['rotate90', 'rotateLeft', 'rotate180', 'delete', 'duplicate', 'blank'] as const;
interface OrganizeOptions { action: typeof organizeActions[number]; paper: 'a4' | 'letter' }

const organize: PdfTool<OrganizeOptions> = {
  id: 'organize', name: 'Organize', category: 'pdf', icon: PanelsTopLeft,
  defaultOptions: { action: 'rotate90', paper: 'a4' },
  parseOptions(value) {
    const { action, paper } = fieldValue(value);
    return { action: choice(action, organizeActions, 'rotate90'), paper: choice(paper, ['a4', 'letter'], 'a4') };
  },
  getApplyError({ action }, { selected, pages }) {
    if (action === 'blank') return;
    if (!selected.length) return 'Select pages first.';
    if (action === 'delete' && selected.length === pages.length) return 'Keep at least one page in the PDF.';
  },
  OptionsPanel({ value, context, onChange }) {
    const message = organize.getApplyError?.(value, context);
    return <div className="option-fields">
      <Choice label="Page action" value={value.action} onChange={event => onChange({ ...value, action: event.target.value as OrganizeOptions['action'] })}>
        <option value="rotate90">Rotate right 90°</option>
        <option value="rotateLeft">Rotate left 90°</option>
        <option value="rotate180">Rotate 180°</option>
        <option value="delete">Delete selected pages</option>
        <option value="duplicate">Duplicate selected pages</option>
        <option value="blank">Insert blank page</option>
      </Choice>
      {value.action === 'blank' && <Choice label="Blank page size" value={value.paper}
        onChange={event => onChange({ ...value, paper: event.target.value as OrganizeOptions['paper'] })}>
        <option value="a4">A4</option><option value="letter">Letter</option>
      </Choice>}
      {message && <p className="section-note">{message}</p>}
    </div>;
  },
  async apply(state, { action, paper }) {
    const selected = ids(state.selected);
    let operation: PageOperation;
    let message: string;
    if (action === 'delete') {
      operation = { kind: 'delete', ids: selected };
      message = `Deleted ${countLabel(selected.length)}.`;
    } else if (action === 'duplicate') {
      operation = { kind: 'duplicate', ids: selected, newIds: selected.map(() => crypto.randomUUID()) };
      message = `Duplicated ${countLabel(selected.length)}.`;
    } else if (action === 'blank') {
      operation = { kind: 'insert', after: selected.at(-1), pages: [{ kind: 'blank', id: crypto.randomUUID(), rotation: 0, size: paper === 'a4' ? a4 : letter }] };
      message = 'Inserted a blank page.';
    } else {
      operation = { kind: 'rotate', ids: selected, clockwise: action === 'rotate180' ? 180 : action === 'rotateLeft' ? -90 : 90 };
      message = `Rotated ${countLabel(selected.length)}.`;
    }
    return { ...state, result: { kind: 'edit', operation, message } };
  },
};

const merge: PdfTool<{ target: string }> = {
  id: 'merge', name: 'Merge', category: 'pdf', icon: Combine, actionLabel: 'Merge PDFs',
  defaultOptions: { target: '' },
  parseOptions(value) {
    const { target } = fieldValue(value);
    return { target: typeof target === 'string' ? target : '' };
  },
  getApplyError({ target }, context) {
    const pdfs = context.documents.filter(file => !file.image);
    if (target) {
      if (!pdfs.some(file => file.id === target && file.id !== context.activeId)) return 'Choose another open PDF.';
      if (!context.selected.length) return 'Select pages to insert.';
    } else if (pdfs.length < 2) return 'Open at least two PDFs to merge.';
  },
  OptionsPanel({ value, context, onChange }) {
    const message = merge.getApplyError?.(value, context);
    return <div className="option-fields">
      <Choice label="Destination" value={value.target} onChange={event => onChange({ target: event.target.value })}>
        <option value="">New PDF in Files order</option>
        {context.documents.filter(file => file.id !== context.activeId && !file.image).map(file =>
          <option value={file.id} key={file.id}>Append selected pages to {file.name}</option>)}
      </Choice>
      <p className="section-note">{message ?? (value.target ? 'Selected pages will be copied to the end.' : 'Drag files to change the merge order.')}</p>
    </div>;
  },
  async apply(state, { target }) {
    const files = state.documents.filter(file => !file.image);
    return { ...state, result: target
      ? { kind: 'edit', target, operation: { kind: 'insert', pages: withNewIds(state.selected) }, message: `Inserted ${countLabel(state.selected.length)}.` }
      : { kind: 'document', name: 'Merged', pages: withNewIds(files.flatMap(file => file.pages)), primary: files[0]?.primary } };
  },
};

const splitModes = ['selected', 'extract-ranges', 'split-ranges', 'every', 'each'] as const;
interface SplitOptions { mode: typeof splitModes[number]; ranges: string; every: number }

function outputGroups({ mode, ranges, every }: SplitOptions, { pages, selected }: PdfToolContext) {
  if (mode === 'selected') {
    if (!selected.length) throw new Error('Select pages to extract.');
    return [selected.map(page => pages.indexOf(page))];
  }
  if (mode === 'each' || mode === 'every') return splitGroups(pages.length, mode === 'each' ? 1 : every);
  const groups = parseRanges(ranges, pages.length);
  return mode === 'extract-ranges' ? [groups.flat()] : groups;
}

const split: PdfTool<SplitOptions> = {
  id: 'split', name: 'Split / extract', category: 'pdf', icon: Files, actionLabel: 'Export split or extract',
  defaultOptions: { mode: 'selected', ranges: '', every: 2 },
  parseOptions(value) {
    const { mode, ranges, every } = fieldValue(value);
    return { mode: choice(mode, splitModes, 'selected'), ranges: typeof ranges === 'string' ? ranges : '', every: typeof every === 'number' ? every : 2 };
  },
  getApplyError(value, context) {
    try { outputGroups(value, context); } catch (error) { return (error as Error).message; }
  },
  OptionsPanel({ value, onChange, context }) {
    const message = split.getApplyError?.(value, context);
    return <div className="option-fields">
      <Choice label="Split method" value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as SplitOptions['mode'] })}>
        <option value="selected">Extract selected pages</option>
        <option value="extract-ranges">Extract ranges into one PDF</option>
        <option value="split-ranges">Split by ranges</option>
        <option value="every">Split every N pages</option>
        <option value="each">One PDF per page (ZIP)</option>
      </Choice>
      {(value.mode === 'extract-ranges' || value.mode === 'split-ranges') && <label className="field pdf-field">
        <span>Page ranges</span>
        <input value={value.ranges} placeholder="1-3, 5, 8-10" onChange={event => onChange({ ...value, ranges: event.target.value })} />
      </label>}
      {value.mode === 'every' && <label className="field pdf-field">
        <span>Pages per PDF</span>
        <input type="number" min={1} value={value.every || ''} onChange={event => onChange({ ...value, every: Number(event.target.value) })} />
      </label>}
      {message && <p className="section-note">{message}</p>}
    </div>;
  },
  async apply(state, options) {
    const archive = options.mode === 'each' || options.mode === 'every' || options.mode === 'split-ranges';
    return { ...state, result: { kind: 'output', groups: outputGroups(options, state), archive, suffix: archive ? '-split' : '-extracted' } };
  },
};

const imageModes = ['new', 'append', 'selected'] as const;
interface ImageOptions extends ImageLayout { mode: typeof imageModes[number] }

const imageInput = (context: PdfToolContext) => context.documents.filter(file => file.image).flatMap(file => file.pages.filter(page => page.kind === 'image'));

const images: PdfTool<ImageOptions> = {
  id: 'images', name: 'Images to PDF', category: 'pdf', icon: ImagePlus, actionLabel: 'Apply image layout',
  defaultOptions: { ...defaultImageLayout, mode: 'new' },
  parseOptions(value) {
    const { mode, size, orientation, margin } = fieldValue(value);
    return {
      mode: choice(mode, imageModes, 'new'), size: choice(size, ['fit', 'a4', 'letter'], 'fit'),
      orientation: choice(orientation, ['auto', 'portrait', 'landscape'], 'auto'),
      margin: typeof margin === 'number' ? margin : 0,
    };
  },
  getApplyError({ mode, margin }, context) {
    if (margin < 0 || margin > 144 || !Number.isFinite(margin)) return 'Use margins between 0 and 144 points.';
    if (mode === 'selected') {
      if (!context.selected.some(page => page.kind === 'image')) return 'Select an image page.';
    } else if (!imageInput(context).length) return 'Add images to the Files strip first.';
  },
  OptionsPanel({ value, context, onChange }) {
    const message = images.getApplyError?.(value, context);
    return <div className="option-fields">
      <Choice label="Image pages" value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as ImageOptions['mode'] })}>
        <option value="new">New PDF from open images</option>
        <option value="append">Add open images to this PDF</option>
        <option value="selected">Update selected image pages</option>
      </Choice>
      <Choice label="Paper size" value={value.size} onChange={event => onChange({ ...value, size: event.target.value as ImageLayout['size'] })}>
        <option value="fit">Fit image</option><option value="a4">A4</option><option value="letter">Letter</option>
      </Choice>
      <Choice label="Orientation" value={value.orientation} onChange={event => onChange({ ...value, orientation: event.target.value as ImageLayout['orientation'] })}>
        <option value="auto">Auto</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option>
      </Choice>
      <label className="field pdf-field"><span>Margins (pt)</span>
        <input type="number" min={0} max={144} step="any" value={value.margin} onChange={event => onChange({ ...value, margin: Number(event.target.value) })} />
      </label>
      {message && <p className="section-note">{message}</p>}
    </div>;
  },
  async apply(state, { mode, ...layout }) {
    if (mode === 'selected') return { ...state, result: { kind: 'edit', operation: { kind: 'layout', ids: ids(state.selected), layout }, message: 'Updated image page layout.' } };
    const pages = withNewIds(imageInput(state).map(page => ({ ...page, layout })));
    return { ...state, result: mode === 'append'
      ? { kind: 'edit', operation: { kind: 'insert', pages }, message: `Added ${countLabel(pages.length)}.` }
      : { kind: 'document', name: 'Images', pages } };
  },
};

const raster: PdfTool<RasterOptions> = {
  id: 'page-images', name: 'PDF to images', category: 'pdf', icon: FileImage, actionLabel: 'Export page images',
  defaultOptions: { format: 'png', dpi: 150 },
  parseOptions(value) {
    const { format, dpi } = fieldValue(value);
    return { format: choice(format, ['png', 'jpeg', 'webp'], 'png'), dpi: dpi === 72 || dpi === 300 ? dpi : 150 };
  },
  getApplyError(_value, { selected, canRender }) {
    if (!canRender) return 'Open this PDF in another browser to export page images.';
    if (!selected.length) return 'Select at least one page.';
  },
  OptionsPanel({ value, context, onChange }) {
    return <div className="option-fields">
      <Choice label="Image format" value={value.format} onChange={event => onChange({ ...value, format: event.target.value as RasterOptions['format'] })}>
        <option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WebP</option>
      </Choice>
      <Choice label="Resolution (DPI)" value={value.dpi} onChange={event => onChange({ ...value, dpi: Number(event.target.value) as RasterOptions['dpi'] })}>
        <option value={72}>72</option><option value={150}>150</option><option value={300}>300</option>
      </Choice>
      <p className="section-note">{context.canRender
        ? context.selected.length > 1 ? 'Multiple page images download as a ZIP.' : 'Choose the pages to export in Preview.'
        : 'Open this PDF in another browser to export page images.'}
        {context.mobile && ' Mobile limits each image to 16 MP and 8,192 pixels per side.'}</p>
    </div>;
  },
  async apply(state, raster) {
    return { ...state, result: { kind: 'output', groups: state.selected.map(page => [state.pages.indexOf(page)]), raster } };
  },
};

export const pdfTools = new CategoryRegistry<PdfToolState, PdfToolContext>('pdf');
pdfTools.register(organize);
pdfTools.register(merge);
pdfTools.register(split);
pdfTools.register(images);
pdfTools.register(raster);
