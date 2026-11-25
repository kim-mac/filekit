import { Zip, ZipPassThrough } from 'fflate';
import { sameBackground, type BackgroundOptions } from '../../tools/image/background-options';
import { compositeBackground } from './background';
import { imageTools } from '../../tools/image';
import { defaultConvertOptions, defaultOutput, outputName, type ConvertOptions, type ImageState } from '../../tools/image/formats';
import { fullGeometry, geometrySize, sameGeometry, scaleGeometry, type ImageGeometry, type Size } from '../../tools/image/geometry';
import { applyRegionBlur } from './blur';
import { decodeImage, encodeImage } from './codecs';
import { flatten, hasTransparency, previewMaxEdge, renderGeometry, resizePreview } from './pixels';
import type {
  FileFailure, ImageExport, ImageRequest, ImageStage, PreviewRequest, PreviewResult, ProgressCallback, ZipResult,
} from './types';

type ReportStage = (stage: ImageStage) => void;
type DecodedImage = Awaited<ReturnType<typeof decodeImage>>;

interface PreviewSource {
  readonly id: string;
  readonly format: DecodedImage['format'];
  readonly width: number;
  readonly height: number;
  readonly maxEdge: number;
  readonly base: ImageData;
  readonly hasAlpha: boolean;
  fullFrame?: ImageData;
  rendered?: { geometry: ImageGeometry; background?: string; edit?: BackgroundOptions; blurKey: string; blob: Blob; hasAlpha: boolean };
}

let activePreview: PreviewSource | undefined;

export function retainPreview(id: string) {
  if (activePreview?.id !== id) activePreview = undefined;
}

async function decodeOriginal(original: File, report: ReportStage, normalize = true) {
  report('Decoding');
  try {
    return await decodeImage(original, normalize);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unsupported image.')) throw error;
    throw new Error('This image could not be decoded. Check that the original opens and add it again.', { cause: error });
  }
}

async function previewSource(request: PreviewRequest, report: ReportStage): Promise<PreviewSource> {
  const { id, original, cache = true } = request;
  const maxEdge = Math.max(1, Math.min(previewMaxEdge, Math.floor(request.maxEdge ?? previewMaxEdge)));
  if (cache) retainPreview(id);
  const cached = cache ? activePreview : undefined;
  if (cached?.maxEdge === maxEdge) return cached;
  const decoded = cached?.fullFrame
    ? { frame: cached.fullFrame, format: cached.format }
    : await decodeForPreview(original, report);
  const { frame, format } = decoded;
  const base = resizePreview(frame, maxEdge);
  const source: PreviewSource = {
    id, format, width: frame.width, height: frame.height, maxEdge, base,
    hasAlpha: hasTransparency(base),
    fullFrame: cache ? frame : undefined,
  };
  if (cache) activePreview = source;
  return source;
}

export function releaseFullPreview() {
  if (activePreview) activePreview.fullFrame = undefined;
}

function decodeForPreview(original: File, report: ReportStage) {
  // Intake can validate another file while the selection remains unchanged.
  // Keep the selected preview base and make room for the temporary decode.
  releaseFullPreview();
  return decodeOriginal(original, report);
}

async function encodePreview(frame: ImageData, hasAlpha: boolean, sourceFormat: DecodedImage['format']): Promise<Blob> {
  if (!hasAlpha && frame.width * frame.height >= 512 * 512 && typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (context) {
      try {
        context.putImageData(frame, 0, 0);
        return await canvas.convertToBlob(sourceFormat === 'jpeg' ? { type: 'image/jpeg', quality: 0.95 } : undefined);
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
  }
  return encodeImage(frame, defaultConvertOptions);
}

async function previewState(source: PreviewSource, commands: ImageRequest['commands']) {
  const state = await imageTools.replay({
    geometry: fullGeometry(source), output: defaultOutput(source.format),
  }, commands);
  return { ...state, output: outputForBackground(state.output, state.backgroundEdit, commands) };
}

async function previewRaster(source: PreviewSource, state: ImageState) {
  const { geometry, backgroundEdit, blurEdits, output } = state;
  if (blurEdits) source.fullFrame = undefined;
  const maxEdge = backgroundEdit?.mask?.outputMaxEdge;
  const base = maxEdge ? resizePreview(source.base, maxEdge) : source.base;
  const composed = backgroundEdit || blurEdits
    ? await applyRasterEdits(new ImageData(base.data.slice(), base.width, base.height), source, state)
    : base;
  let frame = renderGeometry(composed, scaleGeometry(geometry, source, base));
  const hasAlpha = Boolean(source.hasAlpha || backgroundEdit) && hasTransparency(frame);
  const background = hasAlpha && output.format === 'jpeg' ? output.background : undefined;
  if (background) {
    if (frame === source.base) frame = new ImageData(base.data.slice(), base.width, base.height);
    flatten(frame, background);
  }
  return { frame, hasAlpha, background };
}

export async function renderDraft({ id, commands }: Pick<ImageRequest, 'id' | 'commands'>) {
  const source = activePreview;
  if (source?.id !== id) return;
  // Drafts are bounded by the cached preview and never overwrite it.
  source.fullFrame = undefined;
  const { frame } = await previewRaster(source, await previewState(source, commands));
  if (activePreview !== source) return;
  return frame === source.base ? new ImageData(frame.data.slice(), frame.width, frame.height) : frame;
}

export async function renderPreview(request: PreviewRequest, progress: ProgressCallback): Promise<PreviewResult> {
  const report: ReportStage = (stage) => progress({ id: request.id, stage, index: 1, total: 1 });
  const source = await previewSource(request, report);
  report('Rendering preview');
  const state = await previewState(source, request.commands);
  const { geometry, output, backgroundEdit, blurEdits } = state;
  const { format } = source;
  const maxEdge = backgroundEdit?.mask?.outputMaxEdge;
  const outputGeometry = maxEdge ? scaleGeometry(geometry, source, cappedSize(source, maxEdge)) : geometry;
  const blurKey = blurEdits ? JSON.stringify([state.backgroundAfterBlur, blurEdits]) : '';
  let rendered = source.rendered;
  const expectedBackground = rendered?.hasAlpha && output.format === 'jpeg' ? output.background : undefined;
  if (!rendered || !sameGeometry(rendered.geometry, geometry) || rendered.background !== expectedBackground ||
    !sameBackground(rendered.edit, backgroundEdit) || rendered.blurKey !== blurKey) {
    const { frame, hasAlpha, background } = await previewRaster(source, state);
    const blob = await encodePreview(frame, hasAlpha && !background, format);
    rendered = { geometry, edit: backgroundEdit, blurKey, background, hasAlpha, blob };
    source.rendered = rendered;
  }
  return { blob: rendered.blob, info: { ...geometrySize(outputGeometry), hasAlpha: rendered.hasAlpha, format, output,
    backgroundColor: backgroundEdit?.color } };
}

function cappedSize(frame: { width: number; height: number }, edge: number) {
  const scale = Math.min(1, edge / Math.max(frame.width, frame.height));
  return { width: Math.max(1, Math.floor(frame.width * scale)), height: Math.max(1, Math.floor(frame.height * scale)) };
}

function outputForBackground(output: ConvertOptions, edit: BackgroundOptions | undefined, commands: ImageRequest['commands']): ConvertOptions {
  if (!edit) return output;
  const explicitFormat = commands.some(command => command.toolId === 'convert');
  const format = edit.mode === 'transparent' && output.format === 'jpeg' && !explicitFormat ? 'png' : output.format;
  return { ...output, format, background: edit.color };
}

async function applyRasterEdits(frame: ImageData, original: Size, state: ImageState) {
  const { blurEdits = [], backgroundEdit, backgroundAfterBlur = 0 } = state;
  // The background tool replaces its previous settings. Keep the latest
  // matte in source coordinates, at its position among the region blurs.
  for (let index = 0; index <= blurEdits.length; index++) {
    if (backgroundEdit && index === backgroundAfterBlur) await compositeBackground(frame, backgroundEdit);
    const edit = blurEdits[index];
    if (edit) applyRegionBlur(frame, edit.options, geometrySize(edit.geometry), scaleGeometry(edit.geometry, original, frame));
  }
  return frame;
}

async function prepareExport(request: ImageRequest, report: ReportStage) {
  releaseFullPreview();
  // The matte is stored in EXIF-normalized source coordinates. Keep the
  // existing in-place EXIF/crop path for files without a background edit.
  const hasBackground = request.commands.some(command => command.toolId === 'remove-background');
  const { frame: original, format, orientation } = await decodeOriginal(request.original, report, hasBackground);
  const state = await imageTools.replay({
    geometry: fullGeometry(original, hasBackground ? 1 : orientation), output: defaultOutput(format),
  }, request.commands);
  const { geometry, output: conversion, backgroundEdit, blurEdits } = state;
  const output = outputForBackground(conversion, backgroundEdit, request.commands);
  // The AVIF wrapper reads the entire backing buffer, so crops need a dense raster.
  const mode = output.format === 'avif' ? 'orient' : 'compact';
  if (!backgroundEdit && !blurEdits) return { frame: renderGeometry(original, geometry, mode), output };
  const maxEdge = backgroundEdit?.mask?.outputMaxEdge;
  const bounded = maxEdge ? resizePreview(original, maxEdge) : original;
  const mapped = maxEdge ? scaleGeometry(geometry, original, bounded) : geometry;
  report('Applying edits');
  await applyRasterEdits(bounded, original, state);
  return { frame: renderGeometry(bounded, mapped, mode), output };
}

async function encodeRequest(request: ImageRequest, report: ReportStage): Promise<ImageExport> {
  const { frame, output } = await prepareExport(request, report);
  report('Encoding');
  try {
    return { blob: await encodeImage(frame, output), name: outputName(request.original.name, output.format) };
  } catch (error) {
    throw new Error('This image could not be encoded. Try a different output format and export again.', { cause: error });
  }
}

export function exportImage(request: ImageRequest, progress: ProgressCallback): Promise<ImageExport> {
  return encodeRequest(request, (stage) => progress({ id: request.id, stage, index: 1, total: 1 }));
}

function uniqueName(name: string, names: Set<string>) {
  const dot = name.lastIndexOf('.');
  let candidate = name;
  for (let suffix = 2; names.has(candidate.toLowerCase()); suffix++) {
    candidate = `${name.slice(0, dot)} (${suffix})${name.slice(dot)}`;
  }
  names.add(candidate.toLowerCase());
  return candidate;
}

export async function exportZip(requests: readonly ImageRequest[], progress: ProgressCallback): Promise<ZipResult> {
  const chunks: BlobPart[] = [];
  const zip = new Zip((error, data) => {
    if (error) throw error;
    chunks.push(new Blob([data as Uint8Array<ArrayBuffer>]));
  });
  const names = new Set<string>();
  const failures: FileFailure[] = [];
  let count = 0;

  for (const [index, request] of requests.entries()) {
    const report: ReportStage = (stage) => progress({ id: request.id, stage, index: index + 1, total: requests.length });
    let result: ImageExport;
    try {
      result = await encodeRequest(request, report);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export this image.';
      failures.push({ id: request.id, message });
      continue;
    }
    report('Packaging');
    const entry = new ZipPassThrough(uniqueName(result.name, names));
    zip.add(entry);
    // Stream the encoded blob in chunks, retaining only the archive and one active image.
    const reader = result.blob.stream().getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      entry.push(chunk.value);
    }
    entry.push(new Uint8Array(0), true);
    count++;
  }

  zip.end();
  return { blob: count ? new Blob(chunks, { type: 'application/zip' }) : null, failures, count };
}
