import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { fontFaces, pathsOverlay, redactionWarning, textFonts, type Box, type FormWidget, type Overlay, type TextOverlay } from '../../../lib/tools/pdf/overlay';
import { Button } from '../../ui/button';
import { Notice } from '../../ui/notice';
import { Select } from '../../ui/select';
import { PdfFormInput } from './pdf-form-input';
import { SignatureControls } from './pdf-signatures';
import type { Mode, PdfEditor } from './use-pdf-editor';

const tools: [Mode, string][] = [
  ['select', 'Select'], ['pan', 'Pan'], ['text', 'Add text'], ['signature', 'Signature'],
  ['highlight', 'Highlight'], ['underline', 'Underline'], ['strike', 'Strikethrough'], ['pen', 'Draw'], ['eraser', 'Eraser'],
  ['rectangle', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['arrow', 'Arrow'], ['stamp', 'Image / stamp'],
  ['whiteout', 'Whiteout'], ['redaction', 'Redact'], ['forms', 'Fill forms'],
];
const presets = { '#000000': 'Black', '#828282': 'Grey', '#ffffff': 'White' };

function Ink({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [custom, setCustom] = useState(false);
  const showCustom = custom || !(value in presets);
  return <div className="pdf-ink">
    <label className="field pdf-field"><span>{label}</span>
      <Select value={showCustom ? 'custom' : value} onChange={event => {
        if (event.target.value === 'custom') setCustom(true);
        else { setCustom(false); onChange(event.target.value); }
      }}>
        {Object.entries(presets).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        <option value="custom">Custom</option>
      </Select>
    </label>
    {showCustom && <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={value} onChange={event => onChange(event.target.value)} />}
  </div>;
}

function NumberInput({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const [input, setInput] = useState<string>();
  return <label className="field pdf-field"><span>{label}</span><input type="number" min={min} max={max} step="any"
    value={input ?? String(Math.round(value * 10) / 10)} onChange={event => setInput(event.target.value)}
    onBlur={() => {
      if (input?.trim() && Number.isFinite(Number(input))) onChange(Math.min(max, Math.max(min, Number(input))));
      setInput(undefined);
    }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

function TextOptions({ editor, object }: { editor: PdfEditor; object?: TextOverlay }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const seenFocus = useRef(0);
  const { focusText } = editor;
  useEffect(() => {
    if (!textRef.current || focusText <= seenFocus.current) return;
    // Finish the page tap before scrolling the new text input into view.
    const frame = requestAnimationFrame(() => {
      seenFocus.current = focusText;
      textRef.current?.focus({ preventScroll: true });
      textRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusText, object?.id]);
  const current = object ?? editor.style;
  const change = (values: Partial<typeof editor.style>) => {
    if (object) editor.replace({ ...object, ...values });
    else editor.setStyle({ ...editor.style, ...values });
  };
  const script = object?.kind === 'typed-signature';
  return <div className="option-fields">
    {object && <label className="field pdf-field"><span>{script ? 'Signature text' : 'Text'}</span>
      <textarea ref={textRef} aria-label={script ? 'Signature text' : 'Text'} rows={3} maxLength={4000}
        value={editor.draftText?.id === object.id ? editor.draftText.text : object.text}
        onChange={event => editor.setDraftText({ id: object.id, text: event.target.value })}
        onBlur={() => {
          if (editor.draftText?.id === object.id && editor.draftText.text !== object.text) {
            editor.replace({ ...object, text: editor.draftText.text }, 'Updated text.');
          }
          editor.setDraftText(undefined);
        }} onKeyDown={event => {
          if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) event.currentTarget.blur();
        }} />
    </label>}
    <div className="pdf-edit-fields">
      <label className="field pdf-field"><span>Font</span>
        <Select value={current.font} onChange={event => change({ font: event.target.value as TextOverlay['font'] })}>
          {(script ? ['pacifico', 'vibes'] as const : textFonts).map(font => <option key={font} value={font}>{fontFaces[font].label}</option>)}
        </Select>
      </label>
      <NumberInput label="Size (pt)" value={current.size} min={6} max={144} onChange={size => change({ size })} />
      <Ink label="Text color" value={current.color} onChange={color => change({ color })} />
      <label className="field pdf-field"><span>Alignment</span><Select value={current.align}
        onChange={event => change({ align: event.target.value as TextOverlay['align'] })}>
        <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
      </Select></label>
    </div>
    {!script && <label className="pdf-checkbox">
      <input type="checkbox" checked={current.bold} onChange={event => change({ bold: event.target.checked })} /> Bold
    </label>}
  </div>;
}

function DrawingOptions({ editor }: { editor: PdfEditor }) {
  const { mode, selected, style } = editor;
  const object = selected && selected.kind !== 'text' && selected.kind !== 'typed-signature' && 'color' in selected ? selected : undefined;
  const kind = object?.kind ?? mode;
  const shape = kind === 'rectangle' || kind === 'ellipse';
  const drawn = shape || ['line', 'arrow', 'pen', 'drawn-signature'].includes(kind);
  const fill = object && 'thickness' in object ? ('fill' in object ? object.fill : undefined) : editor.fill;
  function updateFill(value?: string) {
    editor.setFill(value);
    if (object?.kind === 'rectangle' || object?.kind === 'ellipse') editor.replace({ ...object, fill: value });
  }
  return <div className="option-fields">
    <div className="pdf-edit-fields">
      <Ink label={kind === 'highlight' ? 'Highlight color' : 'Stroke color'} value={object?.color ?? style.color} onChange={color => {
        editor.setStyle({ ...style, color });
        if (object) editor.replace({ ...object, color });
      }} />
      {drawn && <NumberInput label="Stroke (pt)" min={1} max={36} value={object && 'thickness' in object ? object.thickness : editor.thickness}
        onChange={thickness => {
          editor.setThickness(thickness);
          if (object && 'thickness' in object) editor.replace({ ...object, thickness });
        }} />}
    </div>
    {shape && <label className="pdf-checkbox"><input type="checkbox" checked={Boolean(fill)}
      onChange={event => updateFill(event.target.checked ? '#828282' : undefined)} /> Fill shape</label>}
    {shape && fill && <Ink label="Fill color" value={fill} onChange={updateFill} />}
  </div>;
}

function StampControls({ editor }: { editor: PdfEditor }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  function pick(kind: 'Checkmark' | 'X' | 'Date') {
    const color = editor.style.color;
    if (kind === 'Date') {
      editor.setPlacement({ id: '', kind: 'text', box: { x: 0, y: 0, width: 165, height: 40 },
        ...editor.style, size: 21, text: new Intl.DateTimeFormat().format(new Date()) });
      return;
    }
    const paths = kind === 'Checkmark' ? [[{ x: 0, y: 16 }, { x: 15, y: 0 }, { x: 46, y: 34 }]]
      : [[{ x: 0, y: 0 }, { x: 35, y: 35 }], [{ x: 0, y: 35 }, { x: 35, y: 0 }]];
    editor.setPlacement(pathsOverlay('', 'pen', paths, color, 3));
  }

  return <div className="option-fields">
    <label className="field pdf-field"><span>Stamp image</span>
      <input type="file" accept="image/*" disabled={busy} onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        editor.setPlacement(undefined);
        setBusy(true);
        setError('');
        void editor.loadImage(file, false).then(result => {
          if (live.current) editor.setPlacement({ id: '', kind: 'image', image: result.image, box: { x: 0, y: 0, ...result.size } });
        }, () => {
          if (live.current) setError('Could not open this stamp image. Try a PNG or JPG.');
        }).finally(() => { if (live.current) setBusy(false); });
      }} />
    </label>
    <div className="pdf-actions" role="group" aria-label="Built-in stamps">
      {(['Checkmark', 'X', 'Date'] as const).map(kind => <Button type="button" size="sm" variant="outline" key={kind}
        disabled={busy} onClick={() => pick(kind)}>{kind}</Button>)}
    </div>
    {busy && <p role="status">Preparing stamp image…</p>}
    {error && <Notice variant="error">{error}</Notice>}
  </div>;
}

export function EditControls({ editor }: { editor: PdfEditor }) {
  const { mode, objects, selected } = editor;
  const pending = objects.filter(object => object.kind === 'redaction' && !object.applied).length;
  const active = objects.some(object => object.kind === 'redaction' && object.applied);
  const index = selected ? objects.indexOf(selected) : -1;
  const text = selected?.kind === 'text' || selected?.kind === 'typed-signature' ? selected : undefined;
  const canPlace = mode === 'text' || ((mode === 'stamp' || mode === 'signature') && Boolean(editor.placement));
  const rectangular = ['highlight', 'underline', 'strike', 'rectangle', 'ellipse', 'line', 'arrow', 'whiteout', 'redaction'].includes(mode);
  return <div className="option-fields">
    <Notice announce={false}>Editing existing PDF text is unavailable. Add text or use Whiteout before adding replacement text.</Notice>
    <div className="pdf-actions pdf-edit-toolbar" role="group" aria-label="PDF editing tools">
      {tools.map(([id, label]) => <Button type="button" variant="outline" size="sm" key={id}
        aria-pressed={mode === id} onClick={() => {
          if (id !== mode) editor.setPlacement(undefined);
          editor.setTool(id);
        }}>{label}</Button>)}
    </div>
    {(mode === 'text' || text) && <TextOptions editor={editor} object={text} />}
    {mode === 'signature' && <SignatureControls editor={editor} />}
    {mode === 'stamp' && <StampControls editor={editor} />}
    {(mode === 'pen' || editor.markMode || ['rectangle', 'ellipse', 'line', 'arrow'].includes(mode) ||
      selected && !text && 'color' in selected) && <DrawingOptions editor={editor} />}
    {canPlace && <>
      <p className="section-note">Click or tap the page to place the object.</p>
      <Button type="button" variant="outline" onClick={() => editor.place()}>Place on page</Button>
    </>}
    {(rectangular || mode === 'pen') && <>
      <p className="section-note">Drag on the page to {mode === 'pen' ? 'draw' : 'set the area'}.</p>
      <Button type="button" variant="outline" onClick={() => editor.place()}>Place on page</Button>
    </>}
    {mode === 'whiteout' && <Notice variant="warning" announce={false}>Whiteout is a visual cover only. It is not secure and covered content stays in the PDF.</Notice>}
    {(mode === 'redaction' || pending > 0 || active) && <RedactionControls editor={editor} pending={pending} />}
    {mode === 'forms' && <FormList editor={editor} />}
    {objects.length > 0 && <label className="field pdf-field"><span>Page objects</span>
      <Select value={selected?.id ?? ''} onChange={event => {
        editor.choose(objects.find(object => object.id === event.target.value));
        editor.setTool('select');
      }}><option value="">Select an object</option>
        {objects.map((object, position) => <option value={object.id} key={object.id}>
          {position + 1}. {objectName(object)}
        </option>)}
      </Select>
    </label>}
    {selected && <>
      <div className="pdf-edit-fields">
        {(['x', 'y', 'width', 'height'] as const).map(key =>
          <NumberInput key={`${selected.id}:${key}`} label={`${key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)} (pt)`}
            value={selected.box[key]} min={key.length === 1 ? -100_000 : 1} max={100_000}
            onChange={value => editor.replace({ ...selected, box: { ...selected.box, [key]: value } })} />)}
      </div>
      <div className="pdf-actions" role="group" aria-label="Selected object actions">
        <Button type="button" size="sm" variant="outline" onClick={editor.duplicate}>Duplicate object</Button>
        <Button type="button" size="sm" variant="outline" disabled={index >= objects.length - 1} onClick={() => editor.layer(1)}>Bring forward</Button>
        <Button type="button" size="sm" variant="outline" disabled={index <= 0} onClick={() => editor.layer(-1)}>Send backward</Button>
        <Button type="button" size="sm" variant="ghost" onClick={editor.remove}>Delete object</Button>
      </div>
    </>}
  </div>;
}

function RedactionControls({ editor, pending }: { editor: PdfEditor; pending: number }) {
  return <>
    <Notice variant="warning" announce={false}>{redactionWarning} Exported redactions cannot be undone.</Notice>
    <Dialog.Root>
      <Dialog.Trigger asChild><Button type="button" disabled={!pending}>Apply redactions</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="pdf-dialog-overlay" />
        <Dialog.Content className="pdf-dialog">
          <Dialog.Title>Apply redactions?</Dialog.Title>
          <Dialog.Description>{redactionWarning} The marked content will be permanently removed from the exported PDF.
            Export also removes PDF metadata and any unused resources.</Dialog.Description>
          <div className="pdf-actions">
            <Dialog.Close asChild><Button variant="outline" type="button">Cancel</Button></Dialog.Close>
            <Dialog.Close asChild><Button type="button" onClick={() =>
              editor.update(editor.objects.map(object => object.kind === 'redaction' ? { ...object, applied: true } : object),
                'Applied redactions.')}>Confirm redactions</Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}

function FormList({ editor }: { editor: PdfEditor }) {
  if (editor.data?.error) return <Notice variant="error">Could not read the form fields on this page. Try reopening this PDF.</Notice>;
  if (!editor.data?.value) return <p className="section-note" role="status">Reading page fields…</p>;
  if (!editor.data.value.widgets.length) return <p className="section-note">This page has no supported form fields.</p>;
  return <div className="option-fields">{editor.data.value.widgets.map((widget: FormWidget) =>
    <label className="field pdf-field" key={widget.id}><span>{widget.name}{widget.kind === 'radio' && ` — ${widget.options[0]}`}</span>
      <PdfFormInput widget={widget} editor={editor} placement="panel" />
    </label>)}</div>;
}

function objectName(object: Overlay) {
  if (object.kind === 'text') return object.text.trim().slice(0, 24) || 'Text';
  if (object.kind === 'redaction') return object.applied ? 'Applied redaction' : 'Redaction mark';
  if (object.kind.endsWith('signature')) return 'Signature';
  return tools.find(([id]) => id === object.kind)?.[1] ?? 'Image';
}
