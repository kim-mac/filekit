import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react';
import type { ImageToolContext } from './context';
import { cropPresets, type CropOptions, type CropPreset } from './crop';
import {
  combineOrientations, editGeometry, fullGeometry, geometrySize, orientBounds, orientedSize, orientationMatrix,
  type Bounds, type Orientation, type Size,
} from './geometry';

type Corner = 'top-left' | 'bottom-right';
type Handle = Corner | 'move';

const transformControls = [
  { label: 'Rotate left', shortcut: 'Shift+R', orientation: 8, Icon: RotateCcw },
  { label: 'Rotate right', shortcut: 'R', orientation: 6, Icon: RotateCw },
  { label: 'Flip horizontal', shortcut: 'H', orientation: 2, Icon: FlipHorizontal2 },
  { label: 'Flip vertical', shortcut: 'V', orientation: 4, Icon: FlipVertical2 },
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function centeredCrop({ width, height }: Size, aspect: number): Bounds {
  const cropWidth = clamp(Math.round(aspect * height), 1, width);
  const cropHeight = clamp(Math.round(width / aspect), 1, height);
  const left = Math.floor((width - cropWidth) / 2);
  const top = Math.floor((height - cropHeight) / 2);
  return {
    left: left / width, top: top / height, right: (left + cropWidth) / width, bottom: (top + cropHeight) / height,
  };
}

function adjustBounds(bounds: Bounds, handle: Handle, dx: number, dy: number, size: Size, aspect: number): Bounds {
  const { left, top, right, bottom } = bounds;
  if (handle === 'move') {
    const x = clamp(dx, -left, 1 - right);
    const y = clamp(dy, -top, 1 - bottom);
    return { left: left + x, right: right + x, top: top + y, bottom: bottom + y };
  }

  const reversed = handle === 'top-left';
  const direction = reversed ? -1 : 1;
  const maxWidth = reversed ? right : 1 - left;
  const maxHeight = reversed ? bottom : 1 - top;
  let width = right - left + direction * dx;
  let height = bottom - top + direction * dy;

  if (aspect) {
    const ratio = aspect * size.height / size.width;
    const desiredWidth = Math.abs(dx) >= Math.abs(dy * ratio) ? width : height * ratio;
    width = clamp(desiredWidth, Math.max(1 / size.width, ratio / size.height), Math.min(maxWidth, maxHeight * ratio));
    height = width / ratio;
  } else {
    width = clamp(width, 1 / size.width, maxWidth);
    height = clamp(height, 1 / size.height, maxHeight);
  }

  return reversed
    ? { left: Math.max(0, right - width), top: Math.max(0, bottom - height), right, bottom }
    : { left, top, right: Math.min(1, left + width), bottom: Math.min(1, top + height) };
}

function CropEditor({ value, context, onChange }: PanelProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number; handle: Handle; bounds: Bounds; x: number; y: number; viewport: DOMRect;
  } | null>(null);
  const { bounds, orientation, preset = 'Free' } = value;
  const size = orientedSize(context.size, orientation);
  const sourceIsTransposed = orientation >= 5;
  const { left, top, right, bottom } = bounds;

  useEffect(() => {
    const cropBox = box.current;
    if (!cropBox) return;
    // Opening the tool places keyboard and touch users at the image.
    cropBox.focus({ preventScroll: true });
    cropBox.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  function startDrag(event: PointerEvent<HTMLElement>, handle: Handle) {
    if (context.disabled || event.button !== 0 || drag.current || !viewport.current) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId, handle, bounds, x: event.clientX, y: event.clientY,
      viewport: viewport.current.getBoundingClientRect(),
    };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (context.disabled || !start || start.pointerId !== event.pointerId) return;
    const dx = (event.clientX - start.x) / start.viewport.width;
    const dy = (event.clientY - start.y) / start.viewport.height;
    onChange({ ...value, bounds: adjustBounds(start.bounds, start.handle, dx, dy, size, cropPresets[preset]) });
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  function nudge(event: KeyboardEvent<HTMLElement>, handle: Handle) {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const;
    if (context.disabled || !Object.hasOwn(directions, event.key) || !viewport.current) return;
    event.preventDefault();
    event.stopPropagation();
    const [x, y] = directions[event.key as keyof typeof directions];
    const step = event.shiftKey ? 10 : 1;
    const visible = viewport.current.getBoundingClientRect();
    const dx = x * step / Math.min(size.width, visible.width);
    const dy = y * step / Math.min(size.height, visible.height);
    onChange({ ...value, bounds: adjustBounds(bounds, handle, dx, dy, size, cropPresets[preset]) });
  }

  return (
    <div className="crop-editor" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
      <div className="crop-viewport" ref={viewport} style={{
        aspectRatio: size.width / size.height,
        width: `min(100cqw, ${100 * size.width / size.height}cqh)`,
      }}>
        {context.previewUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- The source is a local preview Blob. */
          <img
            className="crop-source" alt="" src={context.previewUrl} draggable={false}
            style={{
              width: sourceIsTransposed ? `${100 * size.height / size.width}%` : '100%',
              height: sourceIsTransposed ? `${100 * size.width / size.height}%` : '100%',
              transform: `translate(-50%, -50%) matrix(${orientationMatrix[orientation].join(',')},0,0)`,
            }}
          />
        )}
        <div
          ref={box} className="crop-box" role="group" aria-label="Crop box" aria-describedby="crop-instructions"
          tabIndex={context.disabled ? -1 : 0} aria-disabled={context.disabled}
          style={{ left: `${left * 100}%`, top: `${top * 100}%`, right: `${(1 - right) * 100}%`, bottom: `${(1 - bottom) * 100}%` }}
          onPointerDown={(event) => startDrag(event, 'move')}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onKeyDown={(event) => nudge(event, 'move')}
        >
          {(['top-left', 'bottom-right'] as const).map((corner) => (
            <button
              key={corner} className={`crop-handle ${corner}`} type="button"
              aria-label={`Resize crop from ${corner.replace('-', ' ')}`} disabled={context.disabled}
              onPointerDown={(event) => startDrag(event, corner)}
              onKeyDown={(event) => nudge(event, corner)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PanelProps {
  readonly context: ImageToolContext;
  readonly value: CropOptions;
  readonly onChange: (value: CropOptions) => void;
}

export default function CropOptionsPanel({ value, context, onChange }: PanelProps) {
  const { orientation, bounds, preset = 'Free' } = value;
  const dimension = geometrySize(editGeometry(fullGeometry(context.size), bounds, orientation));

  function transform(next: Orientation) {
    const turnsQuarter = next === 6 || next === 8;
    let nextPreset = preset;
    if (turnsQuarter) {
      if (preset === '16:9') nextPreset = '9:16';
      if (preset === '9:16') nextPreset = '16:9';
      if (preset === '4:5') nextPreset = 'Free';
    }
    onChange({
      orientation: combineOrientations(orientation, next), bounds: orientBounds(bounds, next), preset: nextPreset,
    });
  }

  useEffect(() => {
    function keydown(event: globalThis.KeyboardEvent) {
      if (context.disabled || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const key = `${event.shiftKey ? 'Shift+' : ''}${event.key.toUpperCase()}`;
      const control = transformControls.find(({ shortcut }) => shortcut === key);
      if (!control) return;
      event.preventDefault();
      transform(control.orientation);
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  return (
    <div className="option-fields">
      {context.previewTarget && createPortal(<CropEditor context={context} value={value} onChange={onChange} />, context.previewTarget)}
      <fieldset>
        <legend>Crop ratio</legend>
        <div className="format-options crop-ratios">
          {(Object.keys(cropPresets) as CropPreset[]).map((name) => (
            <label key={name}>
              <input type="radio" name="crop-ratio" checked={name === preset} onChange={() => {
                const aspect = cropPresets[name];
                onChange({ ...value, preset: name, bounds: aspect ? centeredCrop(orientedSize(context.size, orientation), aspect) : bounds });
              }} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="transform-controls" role="group" aria-label="Rotate and flip">
        {transformControls.map(({ label, shortcut, orientation: next, Icon }) => (
          <button
            key={label} type="button" className="button secondary" aria-keyshortcuts={shortcut}
            title={`${label} (${shortcut})`} onClick={() => transform(next)}
          >
            <Icon size={16} aria-hidden /> {label}
          </button>
        ))}
      </div>
      <output className="crop-size" aria-label="Crop size">{dimension.width} × {dimension.height} px</output>
      <p className="section-note" id="crop-instructions">Drag the box or its corners. Use arrow keys to move the focused box or corner.</p>
    </div>
  );
}
