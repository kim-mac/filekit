import { Button } from '../../../components/ui/button';
import { ChoiceGroup } from '../../../components/ui/choice-group';
import { Slider } from '../../../components/ui/slider';
import { Toggle } from '../../../components/ui/toggle';
import { ModelDownloadNotice } from '../../../components/ui/model-download-notice';
import { Notice } from '../../../components/ui/notice';
import type { ModelDownload } from '../../core/contracts';
import { isMemoryError, memoryRecovery } from '../../core/processing-error';
import { proxy, wrap, type Remote } from 'comlink';
import { Eraser, Focus, Pencil, RectangleHorizontal, ScanFace, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { yuNetSha256 } from '../../workers/image/face-model';
import type { FaceWorkerApi } from '../../workers/image/faces.worker';
import { BlurEditor, type BlurMode } from './blur-editor';
import { isBlurStroke, type BlurOptions, type BlurShape } from './blur-options';
import type { ImageToolContext } from './context';
import { isMobileDevice } from '../../core/device';

const modes = [
  { id: 'brush', label: 'Brush', Icon: Pencil },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'rectangle', label: 'Rectangle', Icon: RectangleHorizontal },
  { id: 'ellipse', label: 'Ellipse', Icon: Focus },
] as const;

interface Props {
  readonly context: ImageToolContext;
  readonly value: BlurOptions;
  readonly onChange: (value: BlurOptions) => void;
}

export default function BlurOptionsPanel({ context, value, onChange }: Props) {
  const { previewBlob, previewUrl, previewTarget, size, disabled, renderDraft } = context;
  const [mode, setMode] = useState<BlurMode>('brush');
  const [brushSize, setBrushSize] = useState(12);
  const [selected, setSelected] = useState<number>();
  const [draft, setDraft] = useState<{ source: Blob; frame: ImageData }>();
  const [faceStatus, setFaceStatus] = useState('');
  const [faceError, setFaceError] = useState('');
  const [download, setDownload] = useState<ModelDownload>();
  const [finding, setFinding] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const worker = useRef<{ instance: Worker; api: Remote<FaceWorkerApi> } | null>(null);
  const rejectFace = useRef<(error: Error) => void>(null);
  const renderTask = useRef(Promise.resolve());
  const latest = useRef({ previewBlob, value, onChange, disabled });
  const faceRequest = useRef(0);

  useEffect(() => {
    latest.current = { previewBlob, value, onChange, disabled };
  }, [previewBlob, value, onChange, disabled]);

  useEffect(() => {
    return () => {
      faceRequest.current++;
      rejectFace.current?.(new Error('Face detection canceled.'));
      worker.current?.instance.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    faceRequest.current++;
    setFinding(false);
    setFaceStatus('');
    setFaceError('');
    setDownload(undefined);
    setSelected(undefined);
    setDraft(undefined);
    setDraftError(false);
  }, [previewBlob]);

  function faceApi() {
    if (worker.current) return worker.current.api;
    const instance = new Worker(new URL('/workers/faces.worker.js', window.location.origin), { type: 'module' });
    const api = wrap<FaceWorkerApi>(instance);
    function stop() {
      if (worker.current?.instance !== instance) return;
      worker.current = null;
      instance.terminate();
      rejectFace.current?.(new Error('Face detection worker stopped.'));
    }
    instance.addEventListener('error', stop);
    instance.addEventListener('messageerror', stop);
    worker.current = { instance, api };
    return api;
  }

  const hasDraft = value.inverted || value.regions.length > 0;
  useEffect(() => {
    if (disabled || !previewUrl || !previewBlob || !hasDraft) return;
    let current = true;
    const timer = window.setTimeout(() => {
      renderTask.current = renderTask.current.then(async () => {
        if (!current) return;
        try {
          const frame = await renderDraft({ toolId: 'blur', options: value });
          if (current) {
            if (frame) setDraft({ source: previewBlob, frame });
            setDraftError(!frame);
          }
        } catch {
          if (current) setDraftError(true);
        }
      });
    }, 70);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [disabled, hasDraft, previewBlob, previewUrl, renderDraft, value]);

  async function findFaces() {
    if (disabled || finding || rejectFace.current || !previewBlob) return;
    const request = ++faceRequest.current;
    setFinding(true);
    setFaceStatus('Detecting faces…');
    setFaceError('');
    try {
      const interrupted = new Promise<never>((_, reject) => { rejectFace.current = reject; });
      const { aiResults, editKey } = context;
      const key = JSON.stringify([editKey, yuNetSha256]);
      const faces = aiResults.faces?.key === key ? aiResults.faces.boxes
        : await Promise.race([faceApi().findFaces(previewBlob, isMobileDevice(), proxy(update => {
          if (faceRequest.current === request) setDownload(update);
        })), interrupted]);
      if (faceRequest.current !== request || latest.current.previewBlob !== previewBlob || latest.current.disabled) return;
      aiResults.faces = { key, boxes: faces };
      if (faces.length) {
        const regions: BlurShape[] = faces.map(bounds => ({ kind: 'rectangle', bounds }));
        const current = latest.current;
        const existing = current.value.regions;
        // Repeated detection can restore deleted boxes without duplicating
        // the remaining, unmodified detections.
        const added = regions.filter(region => !existing.some(other => (
          !isBlurStroke(other) && other.kind === 'rectangle' &&
          region.bounds.left === other.bounds.left && region.bounds.top === other.bounds.top &&
          region.bounds.right === other.bounds.right && region.bounds.bottom === other.bounds.bottom
        )));
        if (added.length) {
          current.onChange({ ...current.value, regions: [...existing, ...added] });
          setSelected(existing.length);
        }
        setMode('rectangle');
        setFaceStatus(faces.length === 1 ? '1 face detected.' : `${faces.length} faces detected.`);
        previewTarget?.scrollIntoView({ block: 'nearest' });
      } else {
        setFaceStatus('No faces detected.');
      }
    } catch (error) {
      if (faceRequest.current === request) {
        setFaceStatus('');
        setFaceError(isMemoryError(error) ? memoryRecovery : 'Face detection stopped. Try again or draw regions manually.');
      }
    } finally {
      rejectFace.current = null;
      if (faceRequest.current === request) {
        setFinding(false);
        setDownload(undefined);
      }
    }
  }

  const selectedShape = selected !== undefined && value.regions[selected] && !isBlurStroke(value.regions[selected]);
  function deleteShape() {
    if (!selectedShape || disabled) return;
    onChange({ ...value, regions: value.regions.filter((_, index) => index !== selected) });
    setSelected(undefined);
  }

  useEffect(() => {
    if (disabled) return;
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable || event.target.matches('input:not([type=range]), textarea, select')))) return;
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        setBrushSize(current => Math.min(50, Math.max(1, current + (event.key === ']' ? 1 : -1))));
      } else if (event.key === 'Delete' && selectedShape) {
        event.preventDefault();
        deleteShape();
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  return (
    <div className="option-fields blur-options">
      {previewTarget && previewUrl && createPortal(<BlurEditor
        key={previewUrl} regions={value.regions} src={previewUrl} size={size}
        draft={hasDraft && draft?.source === previewBlob ? draft?.frame : undefined} disabled={disabled}
        mode={mode} diameter={brushSize / 100} selected={selected} onSelect={setSelected}
        onCommit={(region, index) => onChange({ ...value, regions: index === undefined
          ? [...value.regions, region]
          : value.regions.map((other, position) => position === index ? region : other) })}
      />, previewTarget)}
      <fieldset>
        <legend>Region tool</legend>
        <div className="blur-modes">
          {modes.map(({ id, label, Icon }) => (
            <Toggle key={id} variant="outline" pressed={mode === id} disabled={disabled}
              onPressedChange={() => {
                setMode(id);
                if (id === 'brush' || id === 'eraser') setSelected(undefined);
              }}>
              <Icon aria-hidden />{label}
            </Toggle>
          ))}
        </div>
      </fieldset>
      {(mode === 'brush' || mode === 'eraser') && (
        <div className="quality-field">
          <span>Brush size <output>{brushSize}%</output></span>
          <Slider className="h-9" aria-label="Brush size" aria-keyshortcuts="[ ]" min={1} max={50} value={[brushSize]}
            onValueChange={([size]) => setBrushSize(size)} disabled={disabled} />
        </div>
      )}
      <fieldset>
        <legend>Effect</legend>
        <ChoiceGroup label="Effect" className="blur-effects"
          items={[{ value: 'gaussian', label: 'Gaussian blur' }, { value: 'pixelate', label: 'Pixelate' }]}
          value={value.effect} disabled={disabled} onChange={effect => onChange({ ...value, effect })} />
      </fieldset>
      <div className="quality-field">
        <span>{value.effect === 'gaussian' ? 'Strength' : 'Block size'} <output>{value.effect === 'gaussian' ? value.strength : value.blockSize}</output></span>
        <Slider className="h-9" aria-label={value.effect === 'gaussian' ? 'Strength' : 'Block size'}
          min={value.effect === 'gaussian' ? 1 : 2} max={100}
          value={[value.effect === 'gaussian' ? value.strength : value.blockSize]} disabled={disabled}
          onValueChange={([amount]) => onChange(value.effect === 'gaussian' ? { ...value, strength: amount } : { ...value, blockSize: amount })}
        />
      </div>
      <label className="blur-invert">
        <input type="checkbox" checked={value.inverted} onChange={event => onChange({ ...value, inverted: event.currentTarget.checked })} />
        Invert selected regions
      </label>
      <div className="blur-actions">
        <Button variant="outline" type="button" disabled={finding || !previewBlob} onClick={() => void findFaces()}>
          <ScanFace size={17} aria-hidden />Detect faces
        </Button>
        {selectedShape && (
          <Button variant="outline" aria-keyshortcuts="Delete" type="button" onClick={deleteShape}>
            <Trash2 size={17} aria-hidden />Delete shape
          </Button>
        )}
      </div>
      {download && download.loaded < download.total ? <ModelDownloadNotice download={download} />
        : faceStatus && <p className="section-note" role="status">{faceStatus}</p>}
      {faceError && <Notice variant="error" onDismiss={() => setFaceError('')}>{faceError}</Notice>}
      {hasDraft && draftError && <Notice variant="error">Could not show the draft. Apply blur to try again.</Notice>}
      <p className="section-note blur-instructions" id="blur-instructions">
        <span>Drag to {mode === 'brush' ? 'paint' : mode === 'eraser' ? 'erase blur' : 'draw or adjust a shape'}.</span>
        <span>Use two fingers to pan and zoom.</span>
      </p>
    </div>
  );
}
