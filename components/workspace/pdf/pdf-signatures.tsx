import { useEffect, useRef, useState } from 'react';
import {
  fontFaces, pathsOverlay, signatureFonts, smoothPath, type Font, type Point,
} from '../../../lib/tools/pdf/overlay';
import { Button } from '../../ui/button';
import { Notice } from '../../ui/notice';
import { Select } from '../../ui/select';
import type { PdfEditor, Signature } from './use-pdf-editor';

const storageKey = 'filekit.pdf.signatures';
type Saved = { id: string; signature: Signature };
const pad = { width: 320, height: 112 };

function openStorage() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(storageKey, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('signatures', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Signature storage is busy.'));
  });
}

async function storage<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openStorage();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('signatures', mode);
      const request = run(transaction.objectStore('signatures'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function SignatureControls({ editor }: { editor: PdfEditor }) {
  const [method, setMethod] = useState<'draw' | 'type' | 'image'>('draw');
  const [text, setText] = useState('');
  const [font, setFont] = useState<Font>('pacifico');
  const [stroke, setStroke] = useState<Point[]>([]);
  const [paths, setPaths] = useState<Point[][]>([]);
  const [image, setImage] = useState<Signature>();
  const [saved, setSaved] = useState<Saved[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const drawing = useRef<{ id: number; points: Point[] }>(null);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    void storage('readonly', store => store.getAll()).then(rows => {
      if (live.current) setSaved(rows as Saved[]);
    }).catch(() => {});
    return () => { live.current = false; };
  }, []);

  function pointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(pad.width, Math.max(0, (event.clientX - rect.left) * pad.width / rect.width)),
      y: Math.min(pad.height, Math.max(0, (event.clientY - rect.top) * pad.height / rect.height)) };
  }

  function signature(): Signature | undefined {
    if (method === 'type' && text.trim()) {
      const size = Math.min(27, 270 / Math.max(1, text.trim().length * .55));
      return { id: '', kind: 'typed-signature', box: { x: 0, y: 0, width: 180, height: 56 }, text, font,
        size, color: '#222222', bold: false, align: 'left' };
    }
    if (method === 'image') return image;
    if (paths.length) return pathsOverlay('', 'drawn-signature', paths.map(path =>
      smoothPath(path.map(({ x, y }) => ({ x, y: pad.height - y })))), '#222222', 2);
  }

  async function chooseFile(file: File) {
    setBusy(true);
    setMessage('');
    setImage(undefined);
    editor.setPlacement(undefined);
    try {
      const result = await editor.loadImage(file, true);
      if (live.current) setImage({ id: '', kind: 'image-signature', image: result.image, box: { x: 0, y: 0, ...result.size } });
    } catch {
      if (live.current) setMessage('Could not open the signature image. Try a PNG or JPG.');
    } finally {
      if (live.current) setBusy(false);
    }
  }

  async function save(value: Signature) {
    try {
      const item = { id: crypto.randomUUID(), signature: value };
      await storage('readwrite', store => store.add(item));
      if (live.current) setSaved(rows => [...rows, item]);
      setMessage('Signature saved.');
    } catch {
      setMessage('Could not save the signature in this browser.');
    }
  }

  async function remove(item: Saved) {
    try {
      await storage('readwrite', store => store.delete(item.id));
      setSaved(rows => rows.filter(row => row.id !== item.id));
      if (editor.placement === item.signature) editor.setPlacement(undefined);
      setMessage('Saved signature deleted.');
    } catch {
      setMessage('Could not delete the saved signature.');
    }
  }

  const ready = signature();
  return <div className="option-fields">
    <label className="field pdf-field"><span>Signature method</span>
      <Select value={method} onChange={event => {
        setMethod(event.target.value as typeof method);
        editor.setPlacement(undefined);
      }}>
        <option value="draw">Draw</option><option value="type">Type</option><option value="image">Choose image</option>
      </Select>
    </label>
    {method === 'draw' && <>
      <svg className="pdf-signature-pad" viewBox={`0 0 ${pad.width} ${pad.height}`} preserveAspectRatio="none"
        role="img" aria-label="Signature drawing pad" onPointerDown={event => {
          if (event.button !== 0 || drawing.current) return;
          const points = [pointer(event)];
          drawing.current = { id: event.pointerId, points };
          setStroke(points);
          if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => {
          const current = drawing.current;
          if (!current || current.id !== event.pointerId) return;
          current.points = [...current.points, pointer(event)];
          setStroke(current.points);
        }} onPointerUp={event => {
          const current = drawing.current;
          if (!current || current.id !== event.pointerId) return;
          const path = [...current.points, pointer(event)];
          setPaths(previous => [...previous, path]);
          drawing.current = null;
          setStroke([]);
          editor.setPlacement(undefined);
        }} onPointerCancel={() => { drawing.current = null; setStroke([]); }}>
        {[...paths, stroke].filter(path => path.length).map((path, index) =>
          <polyline key={index} points={smoothPath(path).map(point => `${point.x},${point.y}`).join(' ')}
            stroke="#222" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
      <Button type="button" variant="outline" size="sm" disabled={!paths.length} onClick={() => {
        setPaths([]);
        editor.setPlacement(undefined);
      }}>Clear drawing</Button>
    </>}
    {method === 'type' && <>
      <label className="field pdf-field"><span>Signature text</span><input maxLength={80} value={text}
        style={{ fontFamily: fontFaces[font].label }} onChange={event => { setText(event.target.value); editor.setPlacement(undefined); }} /></label>
      <label className="field pdf-field"><span>Script font</span><Select value={font} onChange={event => {
        setFont(event.target.value as Font);
        editor.setPlacement(undefined);
      }}>{signatureFonts.map(face => <option key={face} value={face}>{fontFaces[face].label}</option>)}</Select></label>
    </>}
    {method === 'image' && <label className="field pdf-field"><span>Signature image</span>
      <input type="file" accept="image/*" onChange={event => {
        const file = event.target.files?.[0];
        if (file) void chooseFile(file);
        event.target.value = '';
      }} />
      <span className="section-note">Light paper backgrounds are removed automatically.</span>
    </label>}
    {busy && <p role="status">Preparing signature image…</p>}
    <div className="pdf-actions">
      <Button type="button" disabled={!ready || busy} onClick={() => editor.setPlacement(ready)}>Use signature</Button>
      <Button type="button" variant="outline" disabled={!ready || busy} onClick={() => { if (ready) void save(ready); }}>
        Save signature
      </Button>
    </div>
    <p className="section-note">Saved only in this browser.</p>
    {saved.map((item, index) => <div className="pdf-actions" key={item.id}>
      <Button type="button" size="sm" variant="outline" onClick={() => editor.setPlacement(item.signature)}>
        Use saved signature {index + 1}
      </Button>
      <Button type="button" size="sm" variant="ghost" aria-label={`Delete saved signature ${index + 1}`} onClick={() => { void remove(item); }}>
        Delete
      </Button>
    </div>)}
    {message && <Notice variant={message.startsWith('Could') ? 'error' : 'info'}>{message}</Notice>}
  </div>;
}
