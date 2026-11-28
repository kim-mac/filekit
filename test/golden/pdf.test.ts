import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFPageLeaf, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { applyPageOperation, pdfPages } from '../../lib/tools/pdf/pages';
import { writePdf } from '../../lib/workers/pdf/write';

const fixture = async (name: string) => new Blob([new Uint8Array(await readFile(new URL(`../fixtures/pdf/${name}.pdf`, import.meta.url)))]);

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
