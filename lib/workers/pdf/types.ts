import type { EditCommand, ToolProgress } from '../../core/contracts';
import type { PageSize } from '../../tools/pdf/layout';
import type { FormWidget, Matrix } from '../../tools/pdf/overlay';
import type { PageRef } from '../../tools/pdf/pages';

export interface PdfDetails {
  count: number;
  version?: string;
  encrypted: boolean;
  forms: boolean;
  title?: string;
  author?: string;
  producer?: string;
}

export type IntakeResult =
  | { kind: 'pdf'; details: PdfDetails; unlocked?: Blob; canRender: boolean }
  | { kind: 'image'; thumbnail?: Blob; canRender: boolean }
  | { kind: 'password'; incorrect: boolean };

export interface PreviewResult {
  blob: Blob;
  size: PageSize;
  transform: Matrix;
}

export interface PageEditingData { widgets: FormWidget[]; lines: import('../../tools/pdf/overlay').Box[] }
export interface PdfEditExportOptions { editableHighlights?: boolean; flattenFields?: boolean; mobile?: boolean }

export type RasterOptions = { format: 'png' | 'jpeg' | 'webp'; dpi: 72 | 150 | 300 };
export type Sources = Readonly<Record<string, Blob>>;

export interface ExportRequest extends PdfEditExportOptions {
  sources: Sources;
  baseName: string;
  primary?: string;
  strip: boolean;
  initial: readonly PageRef[];
  commands: readonly EditCommand[];
  groups: readonly (readonly number[])[];
  archive?: boolean;
  raster?: RasterOptions & { mobile: boolean; pageNumbers: number[] };
}

export interface ExportResult {
  blob: Blob;
  name: string;
  limited?: boolean;
}

export type ReportPdfProgress = (progress: ToolProgress) => void;

export interface PdfWorkerApi {
  inspect(id: string, file: File, kind: 'pdf' | 'image', password: string | undefined, mobile: boolean,
    report: ReportPdfProgress): Promise<IntakeResult>;
  preview(ref: PageRef, blob: Blob | undefined, edge: number, mobile: boolean): Promise<PreviewResult>;
  size(ref: PageRef, blob: Blob | undefined, mobile: boolean): Promise<PageSize>;
  editing(ref: PageRef, blob: Blob | undefined, mobile: boolean): Promise<PageEditingData>;
  prepareImage(blob: Blob, removeBackground: boolean): Promise<{ image: Blob; size: PageSize }>;
  retain(ids: string[]): Promise<void>;
  export(request: ExportRequest, report: ReportPdfProgress): Promise<ExportResult>;
}
