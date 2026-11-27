import { expose } from 'comlink';
import { editGeometry, fullGeometry } from '../../tools/image/geometry';
import { extrapolateBytes, type EstimateRequest } from '../../tools/image/size-estimate';
import { decodeImage, encodeImage } from './codecs';
import { renderGeometry, resizePreview } from './pixels';

type SampleRequest = EstimateRequest & { sampleId: number };

let current: { id: number; frame: ImageData } | undefined;
let pending = Promise.resolve();

async function estimate({ preview, output, size, crop, sampleId }: SampleRequest) {
  if (current?.id !== sampleId) {
    current = undefined;
    current = { id: sampleId, frame: (await decodeImage(preview)).frame };
  }
  const { frame } = current;
  const cropped = crop ? renderGeometry(frame, editGeometry(fullGeometry(frame), crop.bounds, crop.orientation)) : frame;
  const sample = resizePreview(cropped, 384);
  // JPG may flatten in place. Keep the decoded preview available for other formats.
  const input = sample === frame ? new ImageData(frame.data.slice(), frame.width, frame.height) : sample;
  const { size: bytes } = await encodeImage(input, output);
  return output.format === 'ico' ? bytes : extrapolateBytes(bytes, sample, size);
}

export const sizeEstimateApi = {
  estimate(request: SampleRequest) {
    const result = pending.then(() => estimate(request));
    pending = result.then(() => {}, () => {});
    return result;
  },
};

expose(sizeEstimateApi);
