import { expose } from 'comlink';
import type { Bounds } from '../../tools/image/geometry';
import { decodeImage } from './codecs';
import { detectFaces } from './faces';

export interface FaceWorkerApi {
  findFaces(preview: Blob, mobile: boolean): Promise<Bounds[]>;
}

const api: FaceWorkerApi = {
  async findFaces(preview, mobile) {
    const { frame } = await decodeImage(preview);
    return detectFaces(frame, mobile);
  },
};
expose(api);
