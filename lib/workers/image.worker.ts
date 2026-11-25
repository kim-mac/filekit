import { expose, releaseProxy, type Remote } from 'comlink';
import { exportImage, exportZip, renderPreview } from './image/pipeline';
import type { ImageWorkerApi, ProgressCallback } from './image/types';

function withProgress<Request, Result>(run: (request: Request, progress: ProgressCallback) => Promise<Result>) {
  return async (request: Request, progress: ProgressCallback) => {
    try {
      return await run(request, progress);
    } finally {
      (progress as unknown as Remote<ProgressCallback>)[releaseProxy]();
    }
  };
}

const api: ImageWorkerApi = {
  renderPreview: withProgress(renderPreview),
  exportImage: withProgress(exportImage),
  exportZip: withProgress(exportZip),
};
expose(api);
