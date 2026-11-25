import { Zip, ZipPassThrough } from 'fflate';
import { imageTools } from '../../tools/image';
import { defaultConvertOptions, defaultOutput, outputName } from '../../tools/image/formats';
import { decodeImage, encodeImage } from './codecs';
import { flatten, hasTransparency, resizePreview } from './pixels';
import type {
  FileFailure, ImageExport, ImageRequest, ImageStage, PreviewRequest, PreviewResult, ProgressCallback, ZipResult,
} from './types';

type ReportStage = (stage: ImageStage) => void;

async function replay({ original, commands }: ImageRequest, report: ReportStage) {
  report('Decoding');
  let decoded;
  try {
    decoded = await decodeImage(original);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unsupported image.')) throw error;
    throw new Error('This image could not be decoded. Check that the original opens and add it again.', { cause: error });
  }
  const { frame, format } = decoded;
  const state = await imageTools.replay({ frame, output: defaultOutput(format) }, commands);
  return { ...state, format };
}

export async function renderPreview(request: PreviewRequest, progress: ProgressCallback): Promise<PreviewResult> {
  const report: ReportStage = (stage) => progress({ id: request.id, stage, index: 1, total: 1 });
  const { frame, format, output } = await replay(request, report);
  const hasAlpha = hasTransparency(frame);
  report('Rendering preview');
  const preview = resizePreview(frame, request.maxEdge);
  if (hasAlpha && output.format === 'jpeg') flatten(preview, output.background);
  return {
    blob: await encodeImage(preview, defaultConvertOptions),
    info: { width: frame.width, height: frame.height, hasAlpha, format, output },
  };
}

async function encodeRequest(request: ImageRequest, report: ReportStage): Promise<ImageExport> {
  const { frame, output } = await replay(request, report);
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
