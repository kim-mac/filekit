import { readFile } from 'node:fs/promises';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFPageLeaf, PDFRawStream, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { applyPageOperation, pdfPages } from '../../lib/tools/pdf/pages';
import { writePdf } from '../../lib/workers/pdf/write';
import type { Overlay } from '../../lib/tools/pdf/overlay';

const loadFont = async (filename: string) =>
  new Uint8Array(await readFile(new URL(`../../public/fonts/pdf/${filename}`, import.meta.url))).buffer;

const fixture = async (name: string) => new Blob([new Uint8Array(await readFile(new URL(`../fixtures/pdf/${name}.pdf`, import.meta.url)))]);

it('writes selectable text, script signatures, and editable highlights in page coordinates', async () => {
  const mixed = await fixture('mixed');
  const box = { x: 50, y: 160, width: 230, height: 35 };
  const objects: Overlay[] = [
    { id: 'text', kind: 'text', text: 'Added café', font: 'lato', size: 16, align: 'left', bold: true, color: '#111111', box },
    { id: 'sign', kind: 'typed-signature', text: 'Jane A.', font: 'vibes', size: 24, align: 'left', bold: false,
      color: '#111111', box: { ...box, y: 110 } },
    { id: 'shape', kind: 'rectangle', box: { ...box, y: 80 }, color: '#000000', thickness: 2 },
    { id: 'drawn', kind: 'drawn-signature', box: { x: 48, y: 55, width: 80, height: 16 }, color: '#000000', thickness: 2,
      paths: [[{ x: 0, y: 0 }, { x: .5, y: 1 }, { x: 1, y: .2 }]] },
    { id: 'mark', kind: 'highlight', box: { ...box, y: 280 }, color: '#aaaaaa' },
  ];
  const pages = pdfPages('mixed', 4);
  pages[0] = { ...pages[0], rotation: 90, objects };
  const result = await writePdf({ mixed }, pages, 'mixed', false, undefined, undefined, { loadFont, editableHighlights: true });
  const render = getDocument({ data: result.slice() });
  try {
    const doc = await render.promise;
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.filter(item => 'str' in item);
    expect(text.find(item => item.str === 'Added café')?.transform.slice(-2)).toEqual([50, 179]);
    expect(text.find(item => item.str === 'Jane A.')?.transform.slice(-2)).toEqual([50, 121]);
    expect(page.rotate).toBe(90);
    expect(await page.getAnnotations()).toEqual(expect.arrayContaining([expect.objectContaining({
      subtype: 'Highlight', rect: [50, 280, 280, 315],
    })]));
    const output = await PDFDocument.load(result);
    const contents = output.getPage(0).node.Contents() as PDFArray;
    const operations = contents.asArray().map(ref => output.context.lookup(ref)).filter(stream => stream instanceof PDFRawStream)
      .map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
    expect(operations).toContain('1 0 0 1 50 80 cm');
    expect(operations).toContain('48 55 m');
    expect(operations).toContain('88 71 l');
  } finally {
    await render.destroy();
  }
});

it('writes text upright when placed on a rotated page and rotates the object with later edits', async () => {
  const original = await fixture('mixed');
  const pages = pdfPages('original', 4);
  const object: Overlay = { id: 'upright', kind: 'text', turn: 90, text: 'Placed after rotating', box: { x: 70, y: 50, width: 45, height: 230 },
    font: 'lato', size: 18, color: '#000000', bold: false, align: 'left' };
  pages[1] = { ...pages[1], objects: [object], rotation: 90 };
  const bytes = await writePdf({ original }, pages, 'original', false, undefined, undefined, { loadFont });
  const render = getDocument({ data: bytes.slice() });
  try {
    const pdf = await render.promise;
    const page = await pdf.getPage(2);
    const text = (await page.getTextContent()).items.find(item => 'str' in item && item.str === object.text);
    expect(page.rotate).toBe(180);
    expect(text && 'transform' in text && text.transform.slice(0, 4).map(Math.round)).toEqual([0, 18, -18, 0]);
  } finally {
    await render.destroy();
  }
});

it.each([false, true])('fills form values and exports with flatten=%s', async flattenFields => {
  const form = await fixture('form');
  const pages = pdfPages('form', 1).map(page => ({ ...page, fields: { Input: 'Filled café' } }));
  const result = await writePdf({ form }, pages, 'form', false, undefined, undefined, { loadFont, flattenFields });
  const pdf = await PDFDocument.load(result);
  if (!flattenFields) {
    const form = pdf.getForm();
    const text = form.getTextField('Input');
    expect(text.getText()).toBe('Filled café');
    expect(text.acroField.getDefaultAppearance()).toContain('/FileKitFormFont');
    const fonts = form.acroForm.dict.lookup(PDFName.of('DR'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
    expect(fonts.has(PDFName.of('FileKitFormFont'))).toBe(true);
  } else {
    expect(pdf.getForm().getFields()).toHaveLength(0);
    const task = getDocument({ data: result.slice() });
    try {
      const page = await (await task.promise).getPage(1);
      expect((await page.getTextContent()).items).toEqual(expect.arrayContaining([expect.objectContaining({ str: 'Filled café' })]));
    } finally {
      await task.destroy();
    }
  }
});

it('preserves live filled form fields when their page is copied or merged', async () => {
  const form = await fixture('form');
  const mixed = await fixture('mixed');
  const page = { ...pdfPages('form', 1)[0], fields: { Input: 'Copied value' } };
  const result = await writePdf({ mixed, form }, [pdfPages('mixed', 4)[0], page, { ...page, id: 'duplicate' }],
    'mixed', false, undefined, undefined, { loadFont });
  const pdf = await PDFDocument.load(result);
  expect(pdf.getForm().getTextField('Input').getText()).toBe('Copied value');
  expect(pdf.getForm().getTextField('Input (2)').getText()).toBe('Copied value');
});

it('rebuilds an absent field appearance before flattening an unchanged form', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const form = doc.getForm();
  const field = form.createTextField('Name');
  field.addToPage(page, { x: 50, y: 250, width: 120, height: 28 });
  field.setText('Existing value');
  field.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
  const original = new Blob([new Uint8Array(await doc.save({ updateFieldAppearances: false }))]);
  const result = await writePdf({ original }, pdfPages('original', 1), 'original', false, undefined, undefined,
    { loadFont, flattenFields: true });
  const pdf = await PDFDocument.load(result);
  expect(pdf.getForm().getFields()).toHaveLength(0);
  const task = getDocument({ data: result.slice() });
  try {
    const rendered = await (await task.promise).getPage(1);
    expect((await rendered.getTextContent()).items).toEqual(expect.arrayContaining([expect.objectContaining({ str: 'Existing value' })]));
  } finally {
    await task.destroy();
  }
});

it('keeps the selected radio label when extracting one widget from a multi-page group', async () => {
  const doc = await PDFDocument.create();
  const [north, south] = [doc.addPage(), doc.addPage()];
  const radio = doc.getForm().createRadioGroup('Direction');
  radio.addOptionToPage('North', north);
  radio.addOptionToPage('South', south);
  radio.select('South');
  const original = new Blob([new Uint8Array(await doc.save())]);
  const [, page] = pdfPages('original', 2);
  const result = await writePdf({ original }, [page], 'original', false);
  const field = (await PDFDocument.load(result)).getForm().getRadioGroup('Direction');
  expect(field.getOptions()).toEqual(['South']);
  expect(field.getSelected()).toBe('South');
});

it('preserves selectable text, navigation and metadata across reorder and merge', async () => {
  const first = await fixture('mixed');
  const second = await fixture('form');
  const initial = pdfPages('first', 4);
  const reordered = applyPageOperation(initial, { kind: 'move', ids: [initial[2].id], target: initial[0].id, after: false });
  const result = await writePdf({ first, second }, [...reordered, ...pdfPages('second', 1)], 'first', false);
  const render = getDocument({ data: result.slice(), useSystemFonts: true });
  try {
    const pdf = await render.promise;
    expect(pdf.numPages).toBe(5);
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []);
    expect(text).toContain('Third page');
    const links = await (await pdf.getPage(2)).getAnnotations();
    expect(links[0].url).toBe('https://example.com/');
    expect(await pdf.getPageIndex(links[1].dest[0])).toBe(0);
    const outline = await pdf.getOutline();
    expect(outline?.[0].title).toBe('Third page bookmark');
    expect((await pdf.getPage(3)).rotate).toBe(90);
    const metadata = await pdf.getMetadata();
    expect(metadata.info).toMatchObject({ Title: 'Page samples', Author: 'FileKit' });
  } finally {
    await render.destroy();
  }
});

it('preserves the primary form and can remove document metadata', async () => {
  const form = await fixture('form');
  const result = await writePdf({ form }, pdfPages('form', 1), 'form', true);
  const pdf = await PDFDocument.load(result, { updateMetadata: false });
  expect(pdf.getForm().getTextField('Input').getText()).toBe('Example');
  expect(pdf.context.trailerInfo.Info).toBeUndefined();
  expect(pdf.catalog.has(PDFName.of('Metadata'))).toBe(false);
});

it('excludes omitted page objects even when they are referenced by a chained link action', async () => {
  const original = await PDFDocument.load(await (await fixture('mixed')).arrayBuffer());
  const [included, omitted] = original.getPages();
  const { context } = original;
  included.node.addAnnot(context.register(context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10],
    A: { S: 'URI', URI: PDFString.of('https://example.com'), Next: { S: 'GoTo', D: [omitted.ref, 'Fit'] } },
  })));
  const input = new Blob([new Uint8Array(await original.save())]);
  const extracted = await writePdf({ input }, [pdfPages('input', 1)[0]], 'input', false);
  const pdf = await PDFDocument.load(extracted);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFPageLeaf)).toHaveLength(1);
});

it('keeps duplicate pages independent and retains imported bookmarks when their targets survive', async () => {
  const form = await fixture('form');
  const mixed = await fixture('mixed');
  const original = pdfPages('mixed', 4);
  const result = await writePdf({ form, mixed }, [
    ...pdfPages('form', 1), original[2], { ...original[2], id: 'copy', rotation: 90 },
  ], 'form', false);
  const pdf = await PDFDocument.load(result);
  expect(pdf.getPages().map(page => page.getRotation().angle)).toEqual([0, 0, 90]);
  expect(new Set(pdf.getPages().map(page => page.ref)).size).toBe(3);
  const render = getDocument({ data: result.slice() });
  try {
    const doc = await render.promise;
    expect((await doc.getOutline())?.[0].title).toBe('Third page bookmark');
  } finally {
    await render.destroy();
  }
});
