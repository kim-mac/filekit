import {
  getDocument, PasswordException, PasswordResponses, PDFWorker, type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isMemoryError } from '../../core/processing-error';
import { imagePlacement, pixelDimensions, rotatedSize, type PageSize } from '../../tools/pdf/layout';
import { boxBetween, pageTransform, pdfToView, type Box, type Matrix } from '../../tools/pdf/overlay';
import { imagePage, rotationDegrees, type PageRef } from '../../tools/pdf/pages';
import { decodeImage, encodeImage } from '../image/codecs';
import { resizePreview } from '../image/pixels';
import type { IntakeResult, PageEditingData, PdfDetails, PreviewResult, RasterOptions, ReportPdfProgress } from './types';

const assetRoot = new URL('/workers/pdf/', self.location.origin).href;

type Surface = { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D };

function surface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('This browser cannot render PDF pages in a worker.');
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not create a PDF rendering surface.');
  return { canvas, context };
}

function hasWorkerCanvas() {
  try {
    return Boolean(surface(1, 1));
  } catch {
    return false;
  }
}

class WorkerCanvasFactory {
  create = surface;

  reset({ canvas }: Surface, width: number, height: number) {
    canvas.width = width;
    canvas.height = height;
  }

  destroy(target: Surface) {
    this.reset(target, 0, 0);
  }

  getNoAlphaContext(canvas: OffscreenCanvas) {
    return canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  }
}

// SVG filters are unavailable in a dedicated worker. This matches the PDF.js worker renderer.
class WorkerFilterFactory {
  addFilter() { return 'none'; }
  addAlphaFilter() { return 'none'; }
  addLuminosityFilter() { return 'none'; }
  addKnockoutFilter() { return 'none'; }
  addHCMFilter() { return 'none'; }
  destroy() {}
}

function load(data: ArrayBuffer, mobile: boolean, password?: string) {
  // Pass the port explicitly because PDF.js's default worker initializer reads window.location.
  const port = new Worker(`${assetRoot}pdf.worker.min.mjs`, { type: 'module' });
  const worker = PDFWorker.create({ port });
  let failed = false;
  const failure = new Promise<never>((_, reject) => {
    port.addEventListener('error', () => {
      failed = true;
      reject(new Error('The PDF renderer stopped.'));
    }, { once: true });
  });
  const task = getDocument({
    worker, data: new Uint8Array(data), password, enableXfa: false, disableFontFace: true, useSystemFonts: false,
    useWorkerFetch: true, disableWorkerRendering: true, stopAtErrors: true,
    cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true, iccUrl: `${assetRoot}iccs/`,
    standardFontDataUrl: `${assetRoot}standard_fonts/`, wasmUrl: `${assetRoot}wasm/`,
    // Keep PDF.js's internal image surfaces below the iOS canvas limit too.
    canvasMaxAreaInBytes: mobile ? 48_000_000 : 64_000_000,
    CanvasFactory: WorkerCanvasFactory, FilterFactory: WorkerFilterFactory,
  });
  return {
    promise: Promise.race([task.promise, failure]),
    async destroy() {
      try {
        if (!failed) await task.destroy();
      } finally {
        worker.destroy();
        port.terminate();
      }
    },
  };
}

const sourceBudget = 48 * 1024 * 1024;

export class PdfRenderer {
  private readonly documents = new Map<string, { blob: Blob; task: ReturnType<typeof load> }>();
  private image?: { id: string; size: PageSize; preview: ImageData };
  private readonly canRender = hasWorkerCanvas();

  async retain(ids: string[]) {
    const retained = new Set(ids);
    if (this.image && !retained.has(this.image.id)) this.image = undefined;
    for (const [id, { task }] of this.documents) {
      if (!retained.has(id)) {
        this.documents.delete(id);
        await task.destroy();
      }
    }
  }

  private async remember(id: string, blob: Blob, task: ReturnType<typeof load>) {
    const previous = this.documents.get(id);
    this.documents.delete(id);
    this.documents.set(id, { blob, task });
    if (previous && previous.task !== task) await previous.task.destroy();
    let bytes = [...this.documents.values()].reduce((sum, document) => sum + document.blob.size, 0);
    for (const [key, document] of this.documents) {
      if (key === id || (this.documents.size <= 2 && bytes <= sourceBudget)) break;
      this.documents.delete(key);
      bytes -= document.blob.size;
      await document.task.destroy();
    }
  }

  private async document(id: string, blob: Blob, mobile: boolean) {
    const hit = this.documents.get(id);
    if (hit) {
      await this.remember(id, hit.blob, hit.task);
      return hit.task.promise;
    }
    const task = load(await blob.arrayBuffer(), mobile);
    try {
      const pdf = await task.promise;
      await this.remember(id, blob, task);
      return pdf;
    } catch (error) {
      await task.destroy();
      throw error;
    }
  }

  async inspect(id: string, file: File, kind: 'pdf' | 'image', password: string | undefined, mobile: boolean,
    report: ReportPdfProgress): Promise<IntakeResult> {
    report({ message: kind === 'pdf' ? 'Reading PDF' : 'Decoding image', step: 1, totalSteps: 3 });
    if (kind === 'image') {
      await this.imagePreview(id, file);
      report({ message: 'Drawing image preview', step: 3, totalSteps: 3 });
      const thumbnail = this.canRender
        ? await this.preview(imagePage(id), file, 160, mobile).then(value => value.blob).catch(() => undefined) : undefined;
      return { kind: 'image', thumbnail, canRender: this.canRender };
    }
    let task: ReturnType<typeof load> | undefined;
    try {
      task = load(await file.arrayBuffer(), mobile, password);
      const pdf = await task.promise;
      report({ message: 'Reading document details', step: 2, totalSteps: 3 });
      const { info } = await pdf.getMetadata();
      const fields = info as Record<string, unknown>;
      const string = (key: string) => typeof fields[key] === 'string' ? fields[key] : undefined;
      await pdf.getPage(1);
      const details: PdfDetails = {
        count: pdf.numPages, version: string('PDFFormatVersion'),
        encrypted: Boolean(fields.EncryptFilterName || password !== undefined),
        forms: Boolean(fields.IsAcroFormPresent || fields.IsXFAPresent),
        title: string('Title'), author: string('Author'), producer: string('Producer'),
      };
      let unlocked: Blob | undefined;
      if (details.encrypted) {
        report({ message: 'Unlocking PDF on this device', step: 3, totalSteps: 3 });
        const { unlockPdf } = await import('./unlock');
        unlocked = await unlockPdf(file, password ?? '');
      }
      // A reopened document uses the in-memory unlocked copy and never needs the password again.
      if (unlocked) await task.destroy();
      else await this.remember(id, file, task);
      return { kind: 'pdf', details, unlocked, canRender: this.canRender };
    } catch (error) {
      await task?.destroy();
      if (error instanceof PasswordException) {
        return { kind: 'password', incorrect: error.code === PasswordResponses.INCORRECT_PASSWORD || password !== undefined };
      }
      if (isMemoryError(error)) throw new Error('This device ran out of memory opening the PDF. Close other tabs or try a desktop.');
      if (error instanceof Error && error.message.startsWith('This PDF opens')) throw error;
      throw new Error('This PDF could not be opened. It may be damaged or use an unsupported format.');
    }
  }

  private async imagePreview(id: string, blob: Blob) {
    if (this.image?.id === id) return this.image;
    const { frame } = await decodeImage(blob);
    const preview = resizePreview(frame, 2048);
    this.image = { id, size: { width: frame.width, height: frame.height }, preview };
    return this.image;
  }

  async preview(ref: PageRef, blob: Blob | undefined, edge: number, mobile: boolean): Promise<PreviewResult> {
    if (ref.kind === 'pdf') {
      const pdf = await this.document(ref.source, blob!, mobile);
      return pdfPreview(await pdf.getPage(ref.index + 1), ref.rotation, edge);
    }
    if (ref.kind === 'blank') {
      const size = rotatedSize(ref.size, ref.rotation);
      const { canvas } = simplePage(previewDimensions(size, edge), size, 0);
      try {
        return { size, transform: simpleTransform(ref.size, ref.rotation), blob: await canvas.convertToBlob() };
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    const { size, preview } = await this.imagePreview(ref.source, blob!);
    return imagePreview(ref, size, preview, edge);
  }

  async size(ref: PageRef, blob: Blob | undefined, mobile: boolean): Promise<PageSize> {
    if (ref.kind === 'blank') return rotatedSize(ref.size, ref.rotation);
    if (ref.kind === 'image') {
      const { size } = await this.imagePreview(ref.source, blob!);
      return rotatedSize(imagePlacement(size.width, size.height, ref.layout), ref.rotation);
    }
    const pdf = await this.document(ref.source, blob!, mobile);
    const page = await pdf.getPage(ref.index + 1);
    const { width, height } = page.getViewport({ scale: 1, rotation: rotationDegrees(page.rotate + ref.rotation) });
    return { width, height };
  }

  async editing(ref: PageRef, blob: Blob | undefined, mobile: boolean): Promise<PageEditingData> {
    if (ref.kind !== 'pdf') return { lines: [], widgets: [] };
    const pdf = await this.document(ref.source, blob!, mobile);
    const page = await pdf.getPage(ref.index + 1);
    const lines = (await page.getTextContent()).items.flatMap(item => {
      if (!('str' in item) || !item.str.trim() || !item.width || !item.height) return [];
      const [a, b, , , x, y] = item.transform;
      const length = Math.hypot(a, b) || 1;
      const dx = a / length;
      const dy = b / length;
      const aBox = boxBetween({ x: x + dy * item.height * .2, y: y - dx * item.height * .2 },
        { x: x + dx * item.width - dy * item.height * .8, y: y + dy * item.width + dx * item.height * .8 });
      return [aBox];
    });
    const { info } = await pdf.getMetadata();
    const widgets = (info as Record<string, unknown>).IsAcroFormPresent
      ? await (await import('./forms')).readPageWidgets(blob!, ref.index) : [];
    return { lines, widgets };
  }

  async raster(ref: PageRef, blob: Blob | undefined, options: RasterOptions & { mobile: boolean }, masks: Box[] = []) {
    const { mobile, dpi, format } = options;
    let frame: ImageData;
    let limited: boolean;
    if (ref.kind === 'pdf') {
      const pdf = await this.document(ref.source, blob!, mobile);
      const page = await pdf.getPage(ref.index + 1);
      const rotation = rotationDegrees(page.rotate + ref.rotation);
      const size = page.getViewport({ scale: 1, rotation });
      const dimensions = pixelDimensions(size, dpi, mobile, mobile || masks.length > 0);
      limited = dimensions.limited;
      try {
        frame = await pdfPixels(page, dimensions, rotation);
        if (masks.length) burnMasks(frame, masks, page.getViewport({ scale: dimensions.scale, rotation }).transform as unknown as Matrix);
      } finally {
        page.cleanup();
      }
    } else {
      const source = ref.kind === 'image' ? await decodeImage(blob!) : undefined;
      const placement = ref.kind === 'image' && source
        ? imagePlacement(source.frame.width, source.frame.height, ref.layout) : undefined;
      const paper = ref.kind === 'blank' ? ref.size : placement!;
      const dimensions = pixelDimensions(rotatedSize(paper, ref.rotation), dpi, mobile);
      limited = dimensions.limited;
      let bitmap: ImageBitmap | undefined;
      try {
        if (source) bitmap = await createImageBitmap(source.frame);
        frame = await collectPixels(dimensions, (width, height, x, y) =>
          Promise.resolve(simplePage({ ...dimensions, tile: { width, height, x, y } }, paper, ref.rotation, bitmap, placement)));
      } finally {
        bitmap?.close();
      }
    }
    return { limited, blob: await encodeImage(frame, { format, quality: 92, background: '#ffffff' }) };
  }
}

function burnMasks(frame: ImageData, boxes: Box[], transform: Matrix) {
  for (const box of boxes) {
    const rect = boxBetween(pdfToView(transform, box),
      pdfToView(transform, { x: box.x + box.width, y: box.y + box.height }));
    const left = Math.max(0, Math.floor(rect.x));
    const right = Math.min(frame.width, Math.ceil(rect.x + rect.width));
    const top = Math.max(0, Math.floor(rect.y));
    const bottom = Math.min(frame.height, Math.ceil(rect.y + rect.height));
    if (left >= right || top >= bottom) throw new Error('A redaction is outside its page. Move or remove the mark and apply redactions again.');
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * frame.width + x) * 4;
        frame.data[offset] = frame.data[offset + 1] = frame.data[offset + 2] = 0;
        frame.data[offset + 3] = 255;
      }
    }
  }
}

const simpleTransform = ({ width, height }: PageSize, rotation: number) => pageTransform([0, 0, width, height], rotation);

interface Dimensions extends PageSize { scale: number }
interface Tile extends PageSize { x: number; y: number }

function previewDimensions(size: PageSize, edge: number): Dimensions {
  const scale = edge / Math.max(size.width, size.height);
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), scale };
}

async function pdfSurface(page: PDFPageProxy, scale: number, rotation: number, { width, height, x, y }: Tile) {
  const output = surface(width, height);
  try {
    await page.render({
      canvas: null, canvasContext: output.context as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale, rotation }),
      transform: x || y ? [1, 0, 0, 1, -x, -y] : undefined,
      background: '#ffffff',
    }).promise;
    return output;
  } catch (error) {
    output.canvas.width = output.canvas.height = 0;
    throw error;
  }
}

async function pdfPreview(page: PDFPageProxy, offset: number, edge: number) {
  const rotation = rotationDegrees(page.rotate + offset);
  const { width, height, transform } = page.getViewport({ scale: 1, rotation });
  const size = { width, height };
  const dimensions = previewDimensions(size, edge);
  const rendered = await pdfSurface(page, dimensions.scale, rotation, { ...dimensions, x: 0, y: 0 });
  try {
    return { size, transform: transform as unknown as Matrix, blob: await rendered.canvas.convertToBlob() };
  } finally {
    rendered.canvas.width = rendered.canvas.height = 0;
    page.cleanup();
  }
}

function simplePage(
  dimensions: Dimensions & { tile?: Tile }, paper: PageSize, rotation: number, bitmap?: ImageBitmap,
  layout?: ReturnType<typeof imagePlacement>,
) {
  const { scale, tile = { ...dimensions, x: 0, y: 0 } } = dimensions;
  const rendered = surface(tile.width, tile.height);
  const { context } = rendered;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, tile.width, tile.height);
  if (bitmap && layout) {
    context.translate(dimensions.width / 2 - tile.x, dimensions.height / 2 - tile.y);
    context.rotate(rotation * Math.PI / 180);
    context.scale(scale, scale);
    context.drawImage(bitmap, -layout.imageWidth / 2, -layout.imageHeight / 2, layout.imageWidth, layout.imageHeight);
  }
  return rendered;
}

async function imagePreview(ref: Extract<PageRef, { kind: 'image' }>, original: PageSize, preview: ImageData, edge: number) {
  const layout = imagePlacement(original.width, original.height, ref.layout);
  const size = rotatedSize(layout, ref.rotation);
  const bitmap = await createImageBitmap(preview);
  try {
    const { canvas } = simplePage(previewDimensions(size, edge), layout, ref.rotation, bitmap, layout);
    try {
      return { size, transform: simpleTransform(layout, ref.rotation), blob: await canvas.convertToBlob() };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}

function pdfPixels(page: PDFPageProxy, dimensions: Dimensions, rotation: number) {
  return collectPixels(dimensions, (width, height, x, y) => pdfSurface(page, dimensions.scale, rotation, { width, height, x, y }));
}

async function collectPixels({ width, height }: PageSize, render: (w: number, h: number, x: number, y: number) => Promise<Surface>) {
  // PDF.js uses a canvas drawing target. Read each tile into one full-resolution pixel buffer for the WASM encoder.
  if (width * height <= 8_000_000 && Math.max(width, height) <= 4096) {
    const { canvas, context } = await render(width, height, 0, 0);
    try {
      return context.getImageData(0, 0, width, height);
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  const result = new ImageData(width, height);
  const edge = 2048;
  for (let y = 0; y < height; y += edge) {
    for (let x = 0; x < width; x += edge) {
      const w = Math.min(edge, width - x);
      const h = Math.min(edge, height - y);
      const { canvas, context } = await render(w, h, x, y);
      try {
        const tile = context.getImageData(0, 0, w, h);
        for (let row = 0; row < h; row++) {
          result.data.set(tile.data.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * width + x) * 4);
        }
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
  }
  return result;
}
