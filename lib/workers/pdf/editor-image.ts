import { decodeImage, encodeImage } from '../image/codecs';

export async function prepareImage(blob: Blob, removeBackground: boolean) {
  const { frame } = await decodeImage(blob);
  if (removeBackground) {
    const { data } = frame;
    for (let index = 0; index < data.length; index += 4) {
      const shade = Math.min(data[index], data[index + 1], data[index + 2]);
      if (shade >= 240) data[index + 3] = 0;
      else if (shade > 200) data[index + 3] = Math.round(data[index + 3] * (240 - shade) / 40);
    }
  }
  return { image: await encodeImage(frame, { format: 'png', quality: 100, background: '#ffffff' }),
    size: { width: frame.width, height: frame.height } };
}
