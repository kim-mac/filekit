import {
  clip, concatTransformationMatrix, endPath, LineCapStyle, PDFDocument, PDFFont, PDFImage, PDFPage,
  popGraphicsState, pushGraphicsState, rectangle, rgb, type RGB,
} from 'pdf-lib';
import { absolutePaths, arrowHead, artFrame, fontFaces, textLines, type Font, type Overlay, type TextOverlay } from '../../tools/pdf/overlay';
import { name } from './navigation';

export type LoadFont = (filename: string) => Promise<ArrayBuffer>;
export const staticFont: LoadFont = async filename => {
  const response = await fetch(new URL(`/fonts/pdf/${filename}`, self.location.origin));
  if (!response.ok) throw new Error('Could not load the bundled PDF font. Try exporting again.');
  return response.arrayBuffer();
};

export function overlayResources(document: PDFDocument, loadFont = staticFont) {
  const fonts = new Map<string, Promise<PDFFont>>();
  const images = new WeakMap<Blob, Promise<PDFImage>>();
  let fontkitReady: Promise<void> | undefined;
  return {
    font(family: Font, bold = false, subset = true) {
      const face = fontFaces[family];
      const filename = bold && face.bold ? face.bold : face.regular;
      const key = `${filename}:${subset}`;
      let font = fonts.get(key);
      if (!font) {
        fontkitReady ??= import('@pdf-lib/fontkit').then(({ default: fontkit }) => { document.registerFontkit(fontkit); });
        font = Promise.all([loadFont(filename), fontkitReady]).then(([bytes]) => document.embedFont(bytes, { subset }));
        fonts.set(key, font);
      }
      return font;
    },
    image(blob: Blob) {
      let image = images.get(blob);
      if (!image) {
        image = blob.arrayBuffer().then(bytes => document.embedPng(bytes));
        images.set(blob, image);
      }
      return image;
    },
  };
}

export const markOpacity = .34;
const white = rgb(1, 1, 1);

function color(hex: string): RGB {
  const value = /^#[\da-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0;
  return rgb((value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function writeText(page: PDFPage, { box, color: ink, size, text, align }: TextOverlay, font: PDFFont) {
  const chars = new Set(font.getCharacterSet());
  // The bundled faces have different coverage. Fail visibly if none was chosen that can render the text.
  if ([...text].some(char => !/[\n\r\t]/.test(char) && !chars.has(char.codePointAt(0)!))) {
    throw new Error('The selected PDF font cannot display some characters. Choose another font or change the text.');
  }
  const measure = (line: string) => font.widthOfTextAtSize(line, size);
  const lines = textLines(text, box.width, measure);
  page.pushOperators(pushGraphicsState(), rectangle(box.x, box.y, box.width, box.height), clip(), endPath());
  lines.forEach((line, index) => {
    const y = box.y + box.height - size - index * size * 1.2;
    if (!line || y + size * .25 < box.y) return;
    const free = Math.max(0, box.width - measure(line));
    const x = box.x + (align === 'center' ? free / 2 : align === 'right' ? free : 0);
    page.drawText(line, { x, y, font, size, color: color(ink) });
  });
  page.pushOperators(popGraphicsState());
}

function writeHighlight(page: PDFPage, object: Extract<Overlay, { kind: 'highlight' | 'underline' | 'strike' }>) {
  const { x, y, width, height } = object.box;
  const ink = color(object.color);
  const { context } = page.doc;
  // Supply an appearance for readers that do not synthesize highlights.
  const state = context.register(context.obj({ Type: 'ExtGState', ca: markOpacity, BM: 'Multiply' }));
  const appearance = context.register(context.flateStream(
    `q /GS gs ${ink.red} ${ink.green} ${ink.blue} rg 0 0 ${width} ${height} re f Q`,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, width, height], Resources: { ExtGState: { GS: state } } },
  ));
  const annotation = context.obj({
    Type: 'Annot', Subtype: 'Highlight', Rect: [x, y, x + width, y + height],
    QuadPoints: [x, y + height, x + width, y + height, x, y, x + width, y],
    C: [ink.red, ink.green, ink.blue], CA: markOpacity, F: 4, AP: { N: appearance },
  });
  page.node.addAnnot(context.register(annotation));
}

export async function writeOverlays(page: PDFPage, objects: readonly Overlay[], resources: ReturnType<typeof overlayResources>,
  editable: boolean) {
  for (const object of objects) {
    if (object.turn) {
      const { box, center: { x, y } } = artFrame(object.box, object.turn);
      const angle = object.turn * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos,
        x - cos * x + sin * y, y - sin * x - cos * y));
      await writeOverlays(page, [{ ...object, box, turn: 0 }], resources, editable);
      page.pushOperators(popGraphicsState());
      continue;
    }
    const { kind, box } = object;
    if (kind === 'text' || kind === 'typed-signature') {
      if (object.text.trim()) writeText(page, object, await resources.font(object.font, object.bold));
    } else if (kind === 'whiteout') {
      page.drawRectangle({ ...box, color: white, borderWidth: 0 });
    } else if (kind === 'highlight') {
      if (editable) writeHighlight(page, object);
      else page.drawRectangle({ ...box, color: color(object.color), borderWidth: 0, opacity: markOpacity });
    } else if (kind === 'underline' || kind === 'strike') {
      const y = box.y + (kind === 'strike' ? box.height * .5 : 0);
      page.drawLine({ start: { x: box.x, y }, end: { x: box.x + box.width, y }, thickness: 1.5, color: color(object.color) });
    } else if (kind === 'rectangle' || kind === 'ellipse') {
      const style = { borderColor: color(object.color), color: object.fill ? color(object.fill) : undefined, borderWidth: object.thickness };
      if (kind === 'rectangle') page.drawRectangle({ ...box, ...style });
      else page.drawEllipse({ x: box.x + box.width / 2, y: box.y + box.height / 2, xScale: box.width / 2, yScale: box.height / 2, ...style });
    } else if ('paths' in object) {
      const style = { thickness: object.thickness, color: color(object.color), lineCap: LineCapStyle.Round };
      for (const path of absolutePaths(object)) {
        if (path.length === 1) {
          page.drawCircle({ ...path[0], size: object.thickness / 2, color: style.color });
        }
        for (let index = 1; index < path.length; index++) {
          page.drawLine({ start: path[index - 1], end: path[index], ...style });
        }
        if (kind === 'arrow' && path.length > 1) {
          const end = path[path.length - 1];
          for (const start of arrowHead(path[0], end, object.thickness)) page.drawLine({ start, end, ...style });
        }
      }
    } else if ('image' in object) {
      page.drawImage(await resources.image(object.image), box);
    }
  }
}
