import { isMemoryError, memoryRecovery, processingMessage } from '../../core/processing-error';
import { Zip, ZipPassThrough } from 'fflate';
import type { EditCommand } from '../../core/contracts';
import { sameBackground, type BackgroundOptions } from '../../tools/image/background-options';
import { compositeBackground } from './background';
import { imageTools } from '../../tools/image';
import { defaultConvertOptions, keepOriginalOptions, outputFormats, outputName, resolveOutput, type ImageState } from '../../tools/image/formats';
import { fullGeometry, geometrySize, sameGeometry, scaleGeometry, type ImageGeometry, type Size } from '../../tools/image/geometry';
import { parseUpscale, type UpscaleQuality } from '../../tools/image/upscale-options';
import { upscaleCacheBudget } from '../upscale/cache-budget';
import models from '../upscale/models.json';
import { mapSource, projectMatte, sourceMapping, type SourceMapping } from '../upscale/matte';
import { applyRegionBlur } from './blur';
import { decodeImage, encodeImage } from './codecs';
import { hasTransparency, previewMaxEdge, renderGeometry, resizePreview } from './pixels';
import type {
  ComparisonRequest, FileFailure, ImageExport, ImageProgress, ImageRequest, ImageStage, PreviewRequest, PreviewResult, ProgressCallback, ZipResult,
} from './types';

type ReportStage = (stage: ImageStage, detail?: string, tiles?: ImageProgress['tiles'], download?: ImageProgress['download']) => void;
type DecodedImage = Awaited<ReturnType<typeof decodeImage>>;

interface PreviewSource {
  readonly id: string;
  readonly format: DecodedImage['format'];
  readonly details?: DecodedImage['details'];
  readonly width: number;
  readonly height: number;
  readonly maxEdge: number;
  readonly base: ImageData;
  readonly hasAlpha: boolean;
  fullFrame?: ImageData;
  rendered?: { geometry: ImageGeometry; edit?: BackgroundOptions; blurKey: string; blob: Blob; hasAlpha: boolean };
}

interface UpscaledRaster {
  readonly size: Size;
  readonly frame: ImageData;
  readonly mapping: SourceMapping;
  readonly quality: UpscaleQuality;
  readonly format: DecodedImage['format'];
  readonly details?: DecodedImage['details'];
}

let activeFile: string | undefined;
let activePreview: PreviewSource | undefined;
let activeUpscaled: {
  key: string;
  maxEdge: number;
  raster: UpscaledRaster;
  full?: UpscaledRaster;
} | undefined;

export function retainPreview(id: string) {
  if (activeFile === id) return;
  activeFile = id;
  activePreview = undefined;
  activeUpscaled = undefined;
}

async function decodeOriginal(original: File, report: ReportStage, normalize = true, details = false) {
  report('Decoding');
  try {
    return await decodeImage(original, normalize, details);
  } catch (error) {
    if (isMemoryError(error)) throw new Error(memoryRecovery);
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
    ? { frame: cached.fullFrame, format: cached.format, details: cached.details }
    : await decodeForPreview(original, report);
  const { frame, format, details } = decoded;
  const base = resizePreview(frame, maxEdge);
  const source: PreviewSource = {
    id, format, details, width: frame.width, height: frame.height, maxEdge, base,
    hasAlpha: details?.transparent ?? hasTransparency(base),
    fullFrame: cache ? frame : undefined,
  };
  if (cache && activeFile === id) activePreview = source;
  return source;
}

export function releaseFullPreview() {
  if (activePreview) activePreview.fullFrame = undefined;
}

function decodeForPreview(original: File, report: ReportStage) {
  // Intake can validate another file while the selection remains unchanged.
  // Keep the selected preview base and make room for the temporary decode.
  releaseFullPreview();
  return decodeOriginal(original, report, true, true);
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
  return imageTools.replay({
    geometry: fullGeometry(source), output: keepOriginalOptions,
  }, commands);
}

async function previewRaster(source: PreviewSource, state: ImageState) {
  const { geometry, backgroundEdit, blurEdits } = state;
  if (blurEdits) source.fullFrame = undefined;
  const maxEdge = backgroundEdit?.mask?.outputMaxEdge;
  const base = maxEdge ? resizePreview(source.base, maxEdge) : source.base;
  const composed = backgroundEdit || blurEdits
    ? await applyRasterEdits(new ImageData(base.data.slice(), base.width, base.height), source, state)
    : base;
  const frame = renderGeometry(composed, scaleGeometry(geometry, source, base));
  const hasAlpha = Boolean(source.hasAlpha || backgroundEdit) && hasTransparency(frame);
  return { frame, hasAlpha };
}

function makeThumbnail(frame: ImageData) {
  return encodeImage(resizePreview(frame, 144), defaultConvertOptions);
}

export async function renderComparison(request: ComparisonRequest) {
  const source = await previewSource({ ...request, commands: [], cache: activeFile === request.id }, () => {});
  const { base, format } = source;
  const frame = renderGeometry(base, scaleGeometry(request.mapping, { width: 1, height: 1 }, base));
  return encodePreview(frame, source.hasAlpha, format);
}

export async function renderDraft({ id, commands }: Pick<ImageRequest, 'id' | 'commands'>) {
  const upscale = upscaleProgram(commands);
  if (upscale) {
    const cached = activeUpscaled;
    if (activeFile !== id || cached?.key !== upscale.key) return;
    const { frame } = await finishUpscale(cached.raster, upscale, true);
    if (activeUpscaled !== cached) return;
    return frame === cached.raster.frame ? new ImageData(frame.data.slice(), frame.width, frame.height) : frame;
  }
  const source = activePreview;
  if (source?.id !== id) return;
  // Drafts are bounded by the cached preview and never overwrite it.
  source.fullFrame = undefined;
  const { frame } = await previewRaster(source, await previewState(source, commands));
  if (activePreview !== source) return;
  return frame === source.base ? new ImageData(frame.data.slice(), frame.width, frame.height) : frame;
}

export async function renderPreview(request: PreviewRequest, progress: ProgressCallback): Promise<PreviewResult> {
  const report: ReportStage = (stage, detail, tiles, download) => progress({ id: request.id, stage, detail, tiles, download, index: 1, total: 1 });
  const upscale = upscaleProgram(request.commands);
  if (upscale) return renderUpscaledPreview(request, upscale, report);
  const source = await previewSource(request, report);
  report('Rendering preview');
  const state = await previewState(source, request.commands);
  const { geometry, output: conversion, backgroundEdit, blurEdits } = state;
  const { format } = source;
  const maxEdge = backgroundEdit?.mask?.outputMaxEdge;
  const outputGeometry = maxEdge ? scaleGeometry(geometry, source, cappedSize(source, maxEdge)) : geometry;
  const blurKey = blurEdits ? JSON.stringify([state.backgroundAfterBlur, blurEdits]) : '';
  let rendered = source.rendered;
  let thumbnail: Blob | undefined;
  if (!rendered || !sameGeometry(rendered.geometry, geometry) ||
    !sameBackground(rendered.edit, backgroundEdit) || rendered.blurKey !== blurKey) {
    const { frame, hasAlpha } = await previewRaster(source, state);
    const blob = await encodePreview(frame, hasAlpha, format);
    if (request.thumbnail) thumbnail = await makeThumbnail(frame);
    rendered = { geometry, edit: backgroundEdit, blurKey, hasAlpha, blob };
    source.rendered = rendered;
  }
  return {
    blob: rendered.blob, thumbnail,
    mapping: mapSource(sourceMapping, source, geometry),
    info: { ...geometrySize(outputGeometry), hasAlpha: rendered.hasAlpha, details: source.details, format, conversion, output: resolveOutput(format, conversion) },
  };
}

function cappedSize(frame: { width: number; height: number }, edge: number) {
  const scale = Math.min(1, edge / Math.max(frame.width, frame.height));
  return { width: Math.max(1, Math.floor(frame.width * scale)), height: Math.max(1, Math.floor(frame.height * scale)) };
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

// An upscale consumes the edited raster at that point in history. Geometry
// and region edits after it are expressed in the new pixel coordinate space.
function upscaleProgram(commands: readonly EditCommand[]) {
  const lastUpscale = commands.findLastIndex(({ toolId }) => toolId === 'upscale');
  if (lastUpscale < 0) return;
  const background = commands.findLast(({ toolId }) => toolId === 'remove-background');
  const conversion = commands.findLast(({ toolId }) => toolId === 'convert');
  const removeSuperseded = (command: EditCommand) =>
    command.toolId !== 'convert' && (command.toolId !== 'remove-background' || command === background);
  const prefix = commands.slice(0, lastUpscale + 1).filter(removeSuperseded);
  const suffix = commands.slice(lastUpscale + 1).filter(removeSuperseded);
  const firstUpscale = commands.findIndex(({ toolId }) => toolId === 'upscale');
  const initialBackground = commands.slice(0, firstUpscale).findLast(({ toolId }) => toolId === 'remove-background');
  const maxEdge = (initialBackground?.options as BackgroundOptions | undefined)?.mask?.outputMaxEdge;
  const upscales = prefix.filter(({ toolId }) => toolId === 'upscale').map(({ options }) => parseUpscale(options));
  const modelIds = upscales.map(({ mode }) => models[mode === 'photo' ? 'general' : 'anime'].sha256);
  const key = JSON.stringify([maxEdge, prefix, modelIds]);
  return { prefix, suffix, conversion, maxEdge, key, mobile: upscales.at(-1)!.mobile };
}

type UpscaleProgram = NonNullable<ReturnType<typeof upscaleProgram>>;

async function rasterStage(
  frame: ImageData, size: Size, state: ImageState, mapping: SourceMapping,
  mode: Parameters<typeof renderGeometry>[2],
) {
  const mapped = state.backgroundEdit
    ? { ...state, backgroundEdit: await projectMatte(state.backgroundEdit, mapping) }
    : state;
  if (mode === 'preserve' && (state.blurEdits || state.backgroundEdit)) {
    frame = new ImageData(frame.data.slice(), frame.width, frame.height);
  }
  await applyRasterEdits(frame, size, mapped);
  return renderGeometry(frame, scaleGeometry(state.geometry, size, frame), mode);
}

async function upscalePrefix(
  request: ImageRequest, program: UpscaleProgram, report: ReportStage, preview = false,
): Promise<UpscaledRaster> {
  releaseFullPreview();
  const originalDetails = activePreview?.id === request.id ? activePreview.details : undefined;
  const original = await decodeOriginal(request.original, report, true, preview && !originalDetails);
  const { format, details = originalDetails } = original;
  let { frame } = original;
  let mapping = sourceMapping;
  let quality: UpscaleQuality | undefined;
  let state: ImageState = { geometry: fullGeometry(frame), output: keepOriginalOptions };
  const { runUpscale } = await import('../upscale/inference');
  for (const command of program.prefix) {
    state = await imageTools.get(command.toolId).apply(state, command.options);
    if (!state.upscaleEdit) continue;
    // Preserve the existing iOS matte cap on the original raster when
    // background removal precedes the first upscale.
    const size = { width: frame.width, height: frame.height };
    if (!quality && program.maxEdge) frame = resizePreview(frame, program.maxEdge);
    const nextMapping = mapSource(mapping, frame, scaleGeometry(state.geometry, size, frame));
    frame = await rasterStage(frame, size, state, mapping, 'orient');
    const result = await runUpscale(frame, state.upscaleEdit, (detail, tiles, download) => report('Upscaling', detail, tiles, download));
    frame = result.frame;
    quality = result.quality;
    mapping = nextMapping;
    state = { geometry: fullGeometry(frame), output: state.output };
  }
  if (!quality) throw new Error('An upscale edit is required.');
  return { frame, size: { width: frame.width, height: frame.height }, format, details, mapping, quality };
}

async function finishUpscale(
  raster: UpscaledRaster, program: UpscaleProgram, preview: boolean,
  cached = preview,
) {
  let state = await imageTools.replay({
    geometry: fullGeometry(raster.size), output: keepOriginalOptions,
  }, program.suffix);
  if (program.conversion) state = await imageTools.get('convert').apply(state, program.conversion.options);
  const output = resolveOutput(raster.format, state.output);
  const mode = cached ? 'preserve' : output.format === 'avif' ? 'orient' : 'compact';
  let frame = await rasterStage(raster.frame, raster.size, state, raster.mapping, mode);
  const hasAlpha = preview && hasTransparency(frame);
  // Geometry and raster effects use copies when a retained stage is shared.
  // An opaque encoder may flatten its input, so protect a retained alpha raster.
  if (!preview && !outputFormats[output.format].alpha && cached && frame === raster.frame && hasTransparency(frame)) {
    frame = new ImageData(frame.data.slice(), frame.width, frame.height);
  }
  return { frame, output, hasAlpha, geometry: state.geometry, conversion: state.output };
}

async function renderUpscaledPreview(request: PreviewRequest, program: UpscaleProgram, report: ReportStage): Promise<PreviewResult> {
  const maxEdge = Math.max(1, Math.min(previewMaxEdge, Math.floor(request.maxEdge ?? previewMaxEdge)));
  const { key } = program;
  const cache = request.cache !== false;
  if (cache) retainPreview(request.id);
  const cached = cache && activeUpscaled?.key === key ? activeUpscaled : undefined;
  let raster = cached?.maxEdge === maxEdge ? cached.raster : undefined;
  if (!raster) {
    if (cache && !cached) activeUpscaled = undefined;
    const full = cached?.full ?? await upscalePrefix(request, program, report, true);
    raster = { ...full, frame: resizePreview(full.frame, maxEdge) };
    const memory = (globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
    if (cache && activeFile === request.id) {
      activeUpscaled = {
        key, maxEdge, raster,
        full: full.frame.data.byteLength <= upscaleCacheBudget(program.mobile, memory) ? full : undefined,
      };
    }
  }
  report('Rendering preview');
  const { frame, output, hasAlpha, geometry, conversion } = await finishUpscale(raster, program, true);
  const blob = await encodePreview(frame, hasAlpha, raster.format);
  return {
    blob, thumbnail: request.thumbnail ? await makeThumbnail(frame) : undefined,
    mapping: mapSource(raster.mapping, raster.size, geometry),
    info: { ...geometrySize(geometry), hasAlpha, format: raster.format, details: raster.details, output, conversion, upscale: raster.quality },
  };
}

async function prepareExport(request: ImageRequest, report: ReportStage) {
  const upscale = upscaleProgram(request.commands);
  if (upscale) {
    const cached = activeFile === request.id && activeUpscaled?.key === upscale.key ? activeUpscaled.full : undefined;
    const raster = cached ?? await upscalePrefix(request, upscale, report);
    report('Applying edits');
    return finishUpscale(raster, upscale, false, Boolean(cached));
  }
  releaseFullPreview();
  // The matte is stored in EXIF-normalized source coordinates. Keep the
  // existing in-place EXIF/crop path for files without a background edit.
  const hasBackground = request.commands.some(command => command.toolId === 'remove-background');
  const { frame: original, format, orientation } = await decodeOriginal(request.original, report, hasBackground);
  const state = await imageTools.replay({
    geometry: fullGeometry(original, hasBackground ? 1 : orientation), output: keepOriginalOptions,
  }, request.commands);
  const { geometry, output: conversion, backgroundEdit, blurEdits } = state;
  const output = resolveOutput(format, conversion);
  // The AVIF wrapper reads the entire backing buffer, so crops need a dense raster.
  const mode = output.format === 'avif' ? 'orient' : 'compact';
  report('Applying edits');
  if (!backgroundEdit && !blurEdits) return { frame: renderGeometry(original, geometry, mode), output };
  const maxEdge = backgroundEdit?.mask?.outputMaxEdge;
  const bounded = maxEdge ? resizePreview(original, maxEdge) : original;
  const mapped = maxEdge ? scaleGeometry(geometry, original, bounded) : geometry;
  await applyRasterEdits(bounded, original, state);
  return { frame: renderGeometry(bounded, mapped, mode), output };
}

async function encodeRequest(request: ImageRequest, report: ReportStage): Promise<ImageExport> {
  const { frame, output } = await prepareExport(request, report);
  report('Encoding');
  try {
    return { blob: await encodeImage(frame, output), name: outputName(request.original.name, output.format, request.baseName) };
  } catch (error) {
    if (isMemoryError(error)) throw new Error(memoryRecovery);
    throw new Error('This image could not be encoded. Try a different output format and export again.', { cause: error });
  }
}

export function exportImage(request: ImageRequest, progress: ProgressCallback): Promise<ImageExport> {
  return encodeRequest(request, (stage, detail, tiles, download) => progress({ id: request.id, stage, detail, tiles, download, index: 1, total: 1 }));
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
    const report: ReportStage = (stage, detail, tiles, download) => progress({ id: request.id, stage, detail, tiles, download, index: index + 1, total: requests.length });
    let result: ImageExport;
    try {
      result = await encodeRequest(request, report);
    } catch (error) {
      const message = processingMessage(error, 'Could not export this image. Try a smaller image or a different format.');
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
