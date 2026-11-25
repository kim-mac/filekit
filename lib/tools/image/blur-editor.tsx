import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { isBlurStroke, type BlurPoint, type BlurRegion, type BlurShape, type BlurStroke } from './blur-options';
import type { Bounds, Size } from './geometry';

export type BlurMode = BlurRegion['kind'];
type Transform = { scale: number; x: number; y: number };
type Drag = {
  readonly id: number;
  readonly origin: BlurPoint;
  readonly index?: number;
  readonly handle?: 'start' | 'end';
  readonly original: BlurRegion;
  current: BlurRegion;
};
const fit = { scale: 1, x: 0, y: 0 };
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function boundsBetween(a: BlurPoint, b: BlurPoint): Bounds {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

function adjust(shape: BlurShape, handle: Drag['handle'], origin: BlurPoint, point: BlurPoint, size: Size): BlurShape {
  const { left, top, right, bottom } = shape.bounds;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const minWidth = Math.min(right - left, 1 / size.width);
  const minHeight = Math.min(bottom - top, 1 / size.height);
  if (handle === 'start') {
    return { ...shape, bounds: { left: clamp(left + dx, 0, right - minWidth), top: clamp(top + dy, 0, bottom - minHeight), right, bottom } };
  }
  if (handle === 'end') {
    return { ...shape, bounds: { left, top, right: clamp(right + dx, left + minWidth), bottom: clamp(bottom + dy, top + minHeight) } };
  }
  const x = clamp(dx, -left, 1 - right);
  const y = clamp(dy, -top, 1 - bottom);
  return { ...shape, bounds: {
    left: clamp(left + x), top: clamp(top + y), right: clamp(right + x), bottom: clamp(bottom + y),
  } };
}

interface Props {
  readonly regions: readonly BlurRegion[];
  readonly src: string;
  readonly size: Size;
  readonly draft?: ImageData;
  readonly disabled: boolean;
  readonly mode: BlurMode;
  readonly diameter: number;
  readonly selected?: number;
  readonly onSelect: (index: number | undefined) => void;
  readonly onCommit: (region: BlurRegion, index: number | undefined) => void;
}

function StrokeGuide({ stroke, size }: { stroke: BlurStroke; size: Size }) {
  const radius = stroke.diameter * Math.min(size.width, size.height) / 2;
  const first = stroke.points[0];
  return (
    <svg className={`blur-stroke-guide ${stroke.kind}`} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
      {stroke.points.length === 1
        ? <circle cx={first.x * size.width} cy={first.y * size.height} r={radius} />
        : <polyline fill="none" strokeWidth={2 * radius} strokeLinecap="round" strokeLinejoin="round"
          points={stroke.points.map(point => `${point.x * size.width},${point.y * size.height}`).join(' ')} />}
    </svg>
  );
}

export function BlurEditor({ regions, src, size, draft, disabled, mode, diameter, selected, onSelect, onCommit }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const touches = useRef(new Map<number, BlurPoint>());
  const pinch = useRef<{ center: BlurPoint; distance: number; transform: Transform } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [transform, setTransform] = useState(fit);
  const [gesture, setGesture] = useState<{ region: BlurRegion; index?: number }>();
  const [hover, setHover] = useState<BlurPoint>();
  const painting = mode === 'brush' || mode === 'eraser';

  useEffect(() => {
    if (draft && canvas.current) canvas.current.getContext('2d')?.putImageData(draft, 0, 0);
  }, [draft]);

  function position(event: PointerEvent, box: DOMRect): BlurPoint {
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  }

  function pinchPosition() {
    const [a, b] = touches.current.values();
    const box = surface.current!.getBoundingClientRect();
    return {
      center: { x: (a.x + b.x - box.left - box.right) / 2, y: (a.y + b.y - box.top - box.bottom) / 2 },
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  function cancelDrawing() {
    drag.current = null;
    setGesture(undefined);
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (disabled || event.button !== 0 || !frame.current) return;
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touches.current.size > 1) {
        cancelDrawing();
        if (touches.current.size === 2) pinch.current = { ...pinchPosition(), transform };
        return;
      }
    } else if (drag.current) return;

    const point = position(event, frame.current.getBoundingClientRect());
    const target = event.target instanceof Element ? event.target : undefined;
    const hit = painting ? undefined : target?.closest<HTMLElement>('[data-blur-shape]');
    const index = hit ? Number(hit.dataset.blurShape) : undefined;
    const existing = index === undefined ? undefined : regions[index];
    if (!existing && (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return;

    if (event.pointerType !== 'touch') {
      event.preventDefault();
      (hit ?? event.currentTarget).focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    onSelect(index);
    const handle = target?.closest<HTMLElement>('[data-handle]')?.dataset.handle as Drag['handle'];
    const region = existing ?? (painting
      ? { kind: mode, diameter, points: [point] }
      : { kind: mode, bounds: boundsBetween(point, point) });
    drag.current = { id: event.pointerId, origin: point, index, handle, original: region, current: region };
    setGesture({ region, index });
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !frame.current) return;
    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch.current) {
      if (touches.current.size < 2) return;
      const start = pinch.current;
      const { distance, center } = pinchPosition();
      const scale = clamp(start.transform.scale * distance / Math.max(1, start.distance), 1, 5);
      const ratio = scale / start.transform.scale;
      const limitX = frame.current.offsetWidth * (scale - 1) / 2;
      const limitY = frame.current.offsetHeight * (scale - 1) / 2;
      setTransform({
        scale,
        x: clamp(center.x + (start.transform.x - start.center.x) * ratio, -limitX, limitX),
        y: clamp(center.y + (start.transform.y - start.center.y) * ratio, -limitY, limitY),
      });
      return;
    }
    const box = frame.current.getBoundingClientRect();
    const raw = position(event, box);
    const point = { x: clamp(raw.x), y: clamp(raw.y) };
    if (event.pointerType === 'mouse' && painting) {
      setHover(raw.x === point.x && raw.y === point.y ? point : undefined);
    }
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    if (isBlurStroke(active.current)) {
      const previous = active.current.points.at(-1)!;
      if (Math.hypot((point.x - previous.x) * box.width, (point.y - previous.y) * box.height) < 1) return;
      active.current = { ...active.current, points: [...active.current.points, point] };
    } else if (active.index === undefined) {
      active.current = { ...active.current, bounds: boundsBetween(active.origin, point) };
    } else if (!isBlurStroke(active.original)) {
      active.current = adjust(active.original, active.handle, active.origin, raw, size);
    }
    setGesture({ region: active.current, index: active.index });
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    const active = drag.current;
    if (event.type === 'pointerup' && active?.id === event.pointerId) move(event);
    touches.current.delete(event.pointerId);
    if (!touches.current.size) pinch.current = null;
    if (!active || active.id !== event.pointerId) return;
    cancelDrawing();
    if (event.type !== 'pointerup' || disabled) return;
    const region = active.current;
    if (!isBlurStroke(region)) {
      const { left, right, top, bottom } = region.bounds;
      if (right === left || bottom === top || (active.index !== undefined && region === active.original)) return;
    }
    onCommit(region, active.index);
  }

  function shape(region: BlurShape, index?: number) {
    const { left, top, right, bottom } = region.bounds;
    const active = index !== undefined && selected === index;
    return (
      <div key={index ?? 'drawing'} className={`blur-shape ${region.kind} ${active ? 'selected' : ''}`}
        data-blur-shape={index} role={index === undefined ? undefined : 'group'}
        aria-label={index === undefined ? undefined : `Blur ${region.kind} ${index + 1}`}
        tabIndex={index !== undefined && !painting && !disabled ? 0 : -1}
        onFocus={() => index !== undefined && onSelect(index)}
        style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }}>
        {active && !painting && (['start', 'end'] as const).map(handle => (
          <button className={`blur-handle ${handle}`} key={handle} data-handle={handle} type="button"
            aria-label={`Resize shape from ${handle === 'start' ? 'top left' : 'bottom right'}`} disabled={disabled} />
        ))}
      </div>
    );
  }

  return (
    <div ref={surface} className={`blur-editor ${painting ? 'painting' : ''}`} tabIndex={disabled ? -1 : 0}
      role="group" aria-label="Blur editor" aria-describedby="blur-instructions" aria-disabled={disabled}
      data-zoom={transform.scale} onPointerDown={start} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={finish} onLostPointerCapture={finish} onPointerLeave={() => setHover(undefined)}>
      <div ref={frame} className="blur-frame" style={{
        aspectRatio: size.width / size.height, width: `min(100cqw, ${100 * size.width / size.height}cqh)`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      }}>
        {/* The source is a local preview Blob. */}
        <img className="blur-source" src={src} alt="" draggable={false} hidden={Boolean(draft)} />
        {draft && <canvas className="blur-source" ref={canvas} width={draft.width} height={draft.height} aria-hidden="true" />}
        {regions.map((region, index) => {
          if (isBlurStroke(region)) return null;
          const geometry = gesture?.index === index ? gesture.region : region;
          return !isBlurStroke(geometry) && shape(geometry, index);
        })}
        {gesture && (isBlurStroke(gesture.region)
          ? <StrokeGuide stroke={gesture.region} size={size} />
          : gesture.index === undefined && shape(gesture.region))}
        {hover && painting && !disabled && (
          <div className="blur-cursor" aria-hidden="true" style={{
            left: `${hover.x * 100}%`, top: `${hover.y * 100}%`,
            width: `${100 * diameter * Math.min(size.width, size.height) / size.width}%`,
          }} />
        )}
      </div>
    </div>
  );
}
