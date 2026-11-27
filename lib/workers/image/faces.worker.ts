import type { ModelDownload } from '../../core/contracts';
import { expose, releaseProxy, type Remote } from 'comlink';
import type { Bounds } from '../../tools/image/geometry';
import { decodeImage } from './codecs';
import { detectFaces } from './faces';

export interface FaceWorkerApi {
  findFaces(preview: Blob, mobile: boolean, report: (download: ModelDownload) => void): Promise<Bounds[]>;
}

const api: FaceWorkerApi = {
  async findFaces(preview, mobile, report) {
    try {
      const { frame } = await decodeImage(preview);
      return await detectFaces(frame, mobile, report);
    } finally {
      (report as unknown as Remote<typeof report>)[releaseProxy]();
    }
  },
};
expose(api);
