import { useState } from 'react';
import type { FormWidget } from '../../../lib/tools/pdf/overlay';
import type { PdfEditor } from './use-pdf-editor';

export function PdfFormInput({ widget, editor, placement, readOnly }: {
  widget: FormWidget; editor: PdfEditor; placement: 'page' | 'panel'; readOnly?: boolean;
}) {
  const values = editor.page?.fields;
  const value = values && Object.hasOwn(values, widget.name) ? values[widget.name] : widget.value;
  const [draft, setDraft] = useState<string>();
  const options = {
    'aria-label': placement === 'page' ? `On page: ${widget.name}${widget.kind === 'radio' ? `, ${widget.options[0]}` : ''}` : undefined,
    disabled: readOnly || editor.locked || widget.readOnly,
    'data-pdf-form': true,
  };
  if (widget.kind === 'checkbox' || widget.kind === 'radio') {
    const checkbox = widget.kind === 'checkbox';
    return <input {...options} type={widget.kind} name={checkbox ? undefined : `${placement}:${widget.name}`}
      checked={checkbox ? value === true : value === widget.options[0]}
      onChange={event => editor.fillField(widget.name, checkbox ? event.target.checked : widget.options[0])} />;
  }
  if (widget.kind === 'dropdown') {
    const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return <select {...options} multiple={widget.multiple} value={widget.multiple ? selected : selected[0] ?? ''}
      onChange={event => editor.fillField(widget.name, widget.multiple
        ? [...event.target.selectedOptions].map(option => option.value) : event.target.value || null)}>
      {!widget.multiple && <option value="">Choose an option</option>}
      {widget.options.map(option => <option value={option} key={option}>{option}</option>)}
    </select>;
  }
  const initial = typeof value === 'string' ? value : '';
  const props = { ...options, value: draft ?? initial, maxLength: widget.maxLength,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => {
      if (draft !== undefined && draft !== initial) editor.fillField(widget.name, draft);
      setDraft(undefined);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && (!widget.multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  };
  return widget.multiline ? <textarea {...props} rows={2} /> : <input {...props} type="text" />;
}
