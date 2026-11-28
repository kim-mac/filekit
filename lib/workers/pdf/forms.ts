import {
  PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFRadioGroup, PDFRef, PDFString, PDFTextField,
  PDFWidgetAnnotation, StandardFonts,
  type PDFFont, type PDFObject, type PDFObjectCopier, type PDFPage,
} from 'pdf-lib';
import type { FormValue, FormWidget } from '../../tools/pdf/overlay';
import { name } from './navigation';

const hiddenOnScreen = 1 | 2 | 32; // Invisible, Hidden and NoView.

export async function readPageWidgets(source: Blob, index: number) {
  const document = await PDFDocument.load(await source.arrayBuffer(), { updateMetadata: false });
  return pageWidgets(document, document.getPage(index));
}

export function pageWidgets(document: PDFDocument, page: PDFPage): FormWidget[] {
  if (!document.catalog.has(name('AcroForm'))) return [];
  const annotations = new Set((page.node.Annots()?.asArray() ?? []).map(ref => document.context.lookup(ref)));
  return document.getForm().getFields().flatMap(field => {
    const common = { name: field.getName(), readOnly: field.isReadOnly(), options: [] as string[] };
    return field.acroField.getWidgets().flatMap((widget, index): FormWidget[] => {
      if (!annotations.has(widget.dict)) return [];
      if (widget.getFlags() & hiddenOnScreen) return [];
      const base = { ...common, id: `${field.ref}:${index}`, box: widget.getRectangle() };
      if (!(base.box.width > 0 && base.box.height > 0)) return [];
      if (field instanceof PDFTextField) return [{ ...base, kind: 'text', value: field.getText() ?? '',
        multiline: field.isMultiline(), maxLength: field.getMaxLength() }];
      if (field instanceof PDFCheckBox) return [{ ...base, kind: 'checkbox', value: field.isChecked() }];
      if (field instanceof PDFRadioGroup) {
        const option = widget.getOnValue()?.decodeText();
        const label = field.getOptions()[index] ?? option;
        return label === undefined ? [] : [{ ...base, kind: 'radio', value: field.getSelected() ?? null, options: [label] }];
      }
      if (field instanceof PDFDropdown) return [{ ...base, kind: 'dropdown', value: field.getSelected(),
        options: field.getOptions(), multiple: field.isMultiselect() }];
      return [];
    });
  });
}

export function fillFields(document: PDFDocument, values: Readonly<Record<string, FormValue>>) {
  const form = document.getForm();
  for (const [key, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(key);
    if (field instanceof PDFTextField && typeof value === 'string') field.setText(value);
    if (field instanceof PDFCheckBox) value === true ? field.check() : field.uncheck();
    if (field instanceof PDFRadioGroup) typeof value === 'string' ? field.select(value) : field.clear();
    if (field instanceof PDFDropdown) {
      if (typeof value === 'string' || Array.isArray(value) && value.length) field.select(value);
      else field.clear();
    }
  }
}

const appearanceFont = name('FileKitFormFont');
const fontOperator = /\/[^\s/]+\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+Tf\b/g;

export function updateFields(document: PDFDocument, font: PDFFont, flatten: boolean, values: Readonly<Record<string, FormValue>>) {
  const form = document.getForm();
  form.updateFieldAppearances(font);
  if (flatten) {
    form.flatten({ updateFieldAppearances: false });
    return;
  }
  const updated = form.getFields().filter(field => Object.hasOwn(values, field.getName()) &&
    (field instanceof PDFTextField || field instanceof PDFDropdown));
  if (!updated.length) return;
  const { context } = document;
  const resources = ensureDict(form.acroForm.dict, 'DR');
  const fonts = ensureDict(resources, 'Font');
  if (!fonts.has(appearanceFont)) {
    fonts.set(appearanceFont, document.embedStandardFont(StandardFonts.Helvetica).ref);
  }
  for (const field of updated) {
    // The appearance streams keep their subset font. A viewer editing the live field
    // needs a resizable default face even when the new glyphs are outside that subset.
    for (const part of [field.acroField, ...field.acroField.getWidgets()]) {
      const appearance = part.getDefaultAppearance() ?? '';
      const next = appearance.replace(fontOperator, `${appearanceFont} $1 Tf`);
      part.setDefaultAppearance(next === appearance && !appearance.includes(`${appearanceFont} `)
        ? `${appearance}\n${appearanceFont} 0 Tf` : next);
    }
  }

  function ensureDict(parent: PDFDict, key: string) {
    const current = parent.lookup(name(key));
    if (current instanceof PDFDict) return current;
    const dictionary = context.obj({});
    parent.set(name(key), dictionary);
    return dictionary;
  }
}

// Copied widgets may still point to a field tree containing widgets on excluded pages.
// Register the retained branch and reconnect its widgets to their new page references.
export function importFormFields(output: PDFDocument, pages: readonly PDFPage[], source: PDFDocument, copier: PDFObjectCopier) {
  if (!pages.length || !source.catalog.has(name('AcroForm'))) return;
  const roots = new Map<PDFDict, PDFObject>();
  const branches = new Map<PDFDict, Set<PDFObject>>();
  const { context } = output;
  for (const page of pages) {
    const annotations = page.node.Annots();
    for (const [index, original] of (annotations?.asArray() ?? []).entries()) {
      const widget = context.lookup(original);
      if (!(widget instanceof PDFDict) || widget.get(name('Subtype')) !== name('Widget')) continue;
      const ref = original instanceof PDFRef ? original : context.register(widget);
      if (ref !== original) annotations!.set(index, ref);
      widget.set(name('P'), page.ref);
      let current = widget;
      let key: PDFObject = ref;
      const seen = new Set<PDFDict>();
      while (!seen.has(current)) {
        seen.add(current);
        const parentKey = current.get(name('Parent'));
        const parent = context.lookup(parentKey);
        if (!(parent instanceof PDFDict) || !parentKey) {
          roots.set(current, key);
          break;
        }
        const kids = branches.get(parent) ?? new Set<PDFObject>();
        kids.add(key);
        branches.set(parent, kids);
        current = parent;
        key = parentKey;
      }
    }
  }
  if (!roots.size) return;
  for (const [parent, kids] of branches) {
    const originals = parent.lookup(name('Kids'));
    const order = originals instanceof PDFArray ? originals.asArray() : [];
    const retainedByObject = new Map([...kids].map(ref => [context.lookup(ref), ref]));
    const indices: number[] = [];
    const retained = order.flatMap((ref, index) => {
      const object = context.lookup(ref);
      const replacement = retainedByObject.get(object);
      if (replacement === undefined) return [];
      indices.push(index);
      retainedByObject.delete(object);
      return [replacement];
    });
    parent.set(name('Kids'), context.obj([...retained, ...retainedByObject.values()]));

    if (parent.get(name('FT')) !== name('Btn') || !order.length) continue;
    const opts = parent.lookup(name('Opt'));
    if (opts instanceof PDFArray && opts.size() === order.length && !retainedByObject.size) {
      parent.set(name('Opt'), context.obj(indices.map(index => opts.get(index))));
    }
    const selected = parent.lookup(name('V'));
    if (selected instanceof PDFName && selected !== name('Off') && ![...kids].some(ref => {
      const widget = context.lookup(ref);
      return widget instanceof PDFDict && PDFWidgetAnnotation.fromDict(widget).getOnValue() === selected;
    })) parent.set(name('V'), name('Off'));
  }

  const destination = output.getForm().acroForm.dict;
  const fields = destination.lookup(name('Fields'), PDFArray);
  const existing = new Set(fields.asArray().map(field => fieldTitle(context.lookup(field))));
  for (const [root, ref] of roots) {
    const title = fieldTitle(root);
    if (title) {
      let candidate = title;
      for (let suffix = 2; existing.has(candidate); suffix++) candidate = `${title} (${suffix})`;
      if (candidate !== title) root.set(name('T'), PDFHexString.fromText(candidate));
      existing.add(candidate);
    }
    fields.push(ref instanceof PDFRef ? ref : context.register(root));
  }
  const sourceForm = source.catalog.lookup(name('AcroForm'), PDFDict);
  const defaults = sourceForm.lookup(name('DR'));
  if (!(defaults instanceof PDFDict)) return;
  const current = destination.lookup(name('DR'));
  if (!(current instanceof PDFDict)) {
    destination.set(name('DR'), copier.copy(defaults));
    return;
  }
  for (const [category, contents] of defaults.entries()) {
    const sourceResources = defaults.lookup(category);
    const destinationResources = current.lookup(category);
    if (sourceResources instanceof PDFDict && destinationResources instanceof PDFDict) {
      for (const [key, value] of sourceResources.entries()) {
        if (!destinationResources.has(key)) destinationResources.set(key, copier.copy(value));
      }
    } else if (!current.has(category)) current.set(category, copier.copy(contents));
  }
}

function fieldTitle(object: PDFObject | undefined) {
  const value = object instanceof PDFDict ? object.lookup(name('T')) : undefined;
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : undefined;
}
