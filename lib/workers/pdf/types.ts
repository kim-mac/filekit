import type { EditCommand, ToolProgress } from '../../core/contracts';
import type { PageSize } from '../../tools/pdf/layout';
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
  | { kind: 'pdf'; details: PdfDetails; unlocked?: Blob }
  | { kind: 'image'; thumbnail?: Blob }
  | { kind: 'password'; incorrect: boolean };

export interface PreviewResult {
  blob: Blob;
  size: PageSize;
}

export type RasterOptions = { format: 'png' | 'jpeg' | 'webp'; dpi: 72 | 150 | 300 };
export type Sources = Readonly<Record<string, Blob>>;

export interface ExportRequest {
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
  retain(ids: string[]): Promise<void>;
  export(request: ExportRequest, report: ReportPdfProgress): Promise<ExportResult>;
}
