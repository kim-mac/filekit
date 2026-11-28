import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { absolutePaths, arrowHead, artFrame, boxBetween, fontFaces, pathsOverlay, pdfToView, smoothPath,
  isAppliedRedaction, textLines, viewToPdf, type Box, type Overlay, type Point, type TextOverlay } from '../../../lib/tools/pdf/overlay';
import type { PreviewResult } from '../../../lib/workers/pdf/types';
import { useObjectUrl } from '../use-object-url';
import { PdfFormInput } from './pdf-form-input';
import type { Mode, PdfEditor } from './use-pdf-editor';

type Corner = 'bl' | 'br' | 'tl' | 'tr';
interface Gesture {
  pointer: number;
  start: Point;
  points: Point[];
  old?: Overlay;
  corner?: Corner;
  erased: Set<string>;
}

function within(box: Box, point: Point, tolerance = 0) {
  return point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance &&
    point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance;
}

const cornerPoint = (box: Box, corner: Corner) => ({
  x: box.x + (corner.endsWith('r') ? box.width : 0),
  y: box.y + (corner.startsWith('t') ? box.height : 0),
});
const corners: Corner[] = ['bl', 'br', 'tl', 'tr'];
const opposite: Record<Corner, Corner> = { bl: 'tr', br: 'tl', tl: 'br', tr: 'bl' };
const pathPoints = (path: Point[]) => path.map(({ x, y }) => `${x},${y}`).join(' ');

export function PdfEditLayer({ editor, preview }: { editor: PdfEditor; preview: PreviewResult }) {
  const { size, transform } = preview;
  const { active, locked, mode, selected, objects, frame } = editor;
  const [draft, setDraft] = useState<Overlay>();
  const [erased, setErased] = useState<Set<string>>();
  const gesture = useRef<Gesture>(null);
  const placementClick = useRef<{ mode: Mode; point: Point }>(null);
  const pointerActive = active && !locked && mode !== 'pan' && mode !== 'forms';
  const placing = mode === 'text' || mode === 'signature' || mode === 'stamp';
  useEffect(() => {
    frame.current = { size, transform };
    return () => { frame.current = null; };
  }, [frame, size, transform]);
  const visible = objects.flatMap(object => {
    if (erased?.has(object.id)) return [];
    if (draft?.id === object.id) return [draft];
    if ('text' in object && editor.draftText?.id === object.id) return [{ ...object, text: editor.draftText.text }];
    return [object];
  });
  if (draft && !objects.some(object => object.id === draft.id)) visible.push(draft);
  const selection = draft?.id === selected?.id ? draft : selected;

  function point(event: ReactPointerEvent<SVGSVGElement>) {
    return viewToPdf(transform, { x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), size);
  }

  function erase(current: Gesture, location: Point, radius: number) {
    for (const object of objects) {
      if (object.kind !== 'pen' || !within(object.box, location, radius + object.thickness)) continue;
      if (absolutePaths(object).some(path => path.some((end, index) =>
        distanceToSegment(location, path[Math.max(0, index - 1)], end) <= radius + object.thickness / 2))) {
        current.erased.add(object.id);
      }
    }
    setErased(new Set(current.erased));
  }

  function draftAt(current: Gesture, end: Point): Overlay | undefined {
    const { start, old, corner } = current;
    const { color } = editor.style;
    if (old && corner) {
      const anchor = cornerPoint(old.box, opposite[corner]);
      const box = boxBetween(anchor, end);
      return { ...old, box: { ...box, width: Math.max(1, box.width), height: Math.max(1, box.height) } };
    }
    if (old) return { ...old, box: { ...old.box, x: old.box.x + end.x - start.x, y: old.box.y + end.y - start.y } };
    const id = 'draft';
    const box = boxBetween(start, end);
    switch (mode) {
      case 'pen': return pathsOverlay(id, mode, [smoothPath([...current.points, end])], color, editor.thickness);
      case 'line':
      case 'arrow': return pathsOverlay(id, mode, [[start, end]], color, editor.thickness);
      case 'rectangle':
      case 'ellipse': return { id, kind: mode, box, color, fill: editor.fill, thickness: editor.thickness };
      case 'highlight':
      case 'underline':
      case 'strike': return { id, kind: mode, box, color };
      case 'whiteout': return { id, kind: mode, box };
      case 'redaction': return { id, kind: mode, box, applied: false };
      default: return undefined;
    }
  }

  function clearGesture() {
    gesture.current = null;
    setDraft(undefined);
    setErased(undefined);
  }

  const filling = mode === 'forms' && active;
  const masks = objects.filter(isAppliedRedaction);
  const formWidgets = editor.data?.value?.widgets.filter(widget =>
    (filling || Object.hasOwn(editor.page?.fields ?? {}, widget.name)) &&
    !masks.some(mask => overlaps(mask.box, widget.box))) ?? [];
  return <>
    <svg className="pdf-edit-layer" data-preview-edit={pointerActive ? '' : undefined} data-interactive={pointerActive || undefined}
      data-mode={mode} tabIndex={pointerActive ? 0 : undefined} role={pointerActive ? 'group' : undefined}
      aria-label={pointerActive ? 'PDF page editor' : undefined} aria-hidden={pointerActive ? undefined : true}
      aria-keyshortcuts={pointerActive ? 'Delete Escape ArrowUp ArrowDown ArrowLeft ArrowRight Control+Z Meta+Z Control+Shift+Z Meta+Shift+Z' : undefined}
      viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none"
      onClick={() => {
        const action = placementClick.current;
        placementClick.current = null;
        if (pointerActive && action?.mode === mode) editor.place(action.point);
      }}
      onPointerDown={event => {
        if (!pointerActive || event.button !== 0 || gesture.current) return;
        placementClick.current = null;
        const start = point(event);
        const touchRadius = event.pointerType === 'touch' ? 22 : 13;
        const tolerance = touchRadius * size.width / event.currentTarget.getBoundingClientRect().width / Math.hypot(transform[0], transform[1]);
        const corner = mode === 'select' && selected ? corners.find(key => {
          const position = cornerPoint(selected.box, key);
          return Math.hypot(position.x - start.x, position.y - start.y) <= tolerance;
        }) : undefined;
        const hit = mode === 'select' ? corner ? selected : objects.findLast(object => within(object.box, start, tolerance / 3)) : undefined;
        if (mode === 'select') editor.choose(hit);
        if (mode === 'select' && !hit) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { pointer: event.pointerId, start, points: [start], old: hit, corner, erased: new Set() };
        if (mode === 'eraser') erase(gesture.current, start, tolerance / 2);
      }} onPointerMove={event => {
        const current = gesture.current;
        if (!current || event.pointerId !== current.pointer) return;
        const end = point(event);
        if (mode === 'eraser') {
          const tolerance = 10 * size.width / event.currentTarget.getBoundingClientRect().width / Math.hypot(transform[0], transform[1]);
          erase(current, end, tolerance);
          return;
        }
        setDraft(draftAt(current, end));
        if (mode === 'pen') current.points.push(end);
      }} onPointerCancel={clearGesture} onLostPointerCapture={clearGesture}
      onPointerUp={event => {
        const current = gesture.current;
        if (!current || event.pointerId !== current.pointer) return;
        event.preventDefault();
        const end = point(event);
        const finished = draftAt(current, end);
        if (placing) placementClick.current = { mode, point: current.start };
        else if (mode === 'eraser' && current.erased.size) {
          editor.update(objects.filter(object => !current.erased.has(object.id)), 'Erased strokes.');
        } else if (current.old && finished && Math.hypot(end.x - current.start.x, end.y - current.start.y) > .25) {
          editor.replace(finished, current.corner ? 'Resized object.' : 'Moved object.');
        } else if (!current.old && finished && (mode === 'pen' ||
          (mode === 'line' || mode === 'arrow' ? Math.hypot(end.x - current.start.x, end.y - current.start.y) >= 2
            : finished.box.width >= 2 && finished.box.height >= 2))) {
          if (finished.kind === 'highlight' || finished.kind === 'underline' || finished.kind === 'strike') {
            const lines = snapLines(finished.box, editor.data?.value?.lines ?? []);
            const marks = lines.map(box => ({ ...finished, id: crypto.randomUUID(), box }));
            editor.update([...objects, ...marks], 'Added text markup.');
            editor.choose(marks.at(-1));
          } else editor.add({ ...finished, id: crypto.randomUUID() });
        }
        clearGesture();
      }}>
      <g transform={`matrix(${transform.join(' ')})`}>
        {visible.filter(object => object.kind !== 'redaction').map(object => <ObjectShape key={object.id} object={object} />)}
        {visible.filter(object => object.kind === 'redaction').map(object => <ObjectShape key={object.id} object={object} />)}
        {active && selection && mode === 'select' && <g className="pdf-object-selection">
          <rect {...selection.box} vectorEffect="non-scaling-stroke" />
          {corners.map(corner => {
            const { x, y } = cornerPoint(selection.box, corner);
            return <circle key={corner} cx={x} cy={y} r={4} vectorEffect="non-scaling-stroke" />;
          })}
        </g>}
      </g>
    </svg>
    {formWidgets.map(widget => {
      const { box } = widget;
      const display = boxBetween(pdfToView(transform, box),
        pdfToView(transform, { x: box.x + box.width, y: box.y + box.height }));
      return <div key={widget.id} className="pdf-positioned-field" data-preview-edit={filling ? '' : undefined}
        aria-hidden={filling ? undefined : true} data-read-only={filling ? undefined : true} style={{
        left: `${display.x / size.width * 100}%`, top: `${display.y / size.height * 100}%`,
        width: `${display.width / size.width * 100}%`, height: `${display.height / size.height * 100}%`,
      }}><PdfFormInput widget={widget} editor={editor} placement="page" readOnly={!filling} /></div>;
    })}
  </>;
}

function ObjectShape({ object }: { object: Overlay }) {
  if (object.turn) {
    const { box, center } = artFrame(object.box, object.turn);
    return <g transform={`rotate(${object.turn} ${center.x} ${center.y})`}>
      <ObjectShape object={{ ...object, box, turn: 0 }} />
    </g>;
  }
  const { box, kind } = object;
  if (kind === 'text' || kind === 'typed-signature') return <TextShape object={object} />;
  if (kind === 'whiteout') return <rect {...box} fill="white" />;
  if (kind === 'redaction') return <rect {...box} fill={object.applied ? 'black' : 'rgb(0 0 0 / .25)'}
    stroke={object.applied ? 'none' : 'black'} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />;
  if (kind === 'highlight') return <rect {...box} fill={object.color} opacity={.34} />;
  if (kind === 'underline' || kind === 'strike') {
    const y = box.y + (kind === 'strike' ? box.height / 2 : 0);
    return <line x1={box.x} y1={y} x2={box.x + box.width} y2={y} stroke={object.color} strokeWidth={1.5} />;
  }
  if (kind === 'rectangle') return <rect {...box} stroke={object.color} fill={object.fill ?? 'none'} strokeWidth={object.thickness} />;
  if (kind === 'ellipse') return <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2}
    stroke={object.color} fill={object.fill ?? 'none'} strokeWidth={object.thickness} />;
  if ('image' in object) return <ImageShape image={object.image} box={box} />;
  if (!('paths' in object)) return null;
  const paths = absolutePaths(object);
  if (kind === 'arrow' && paths[0]?.length > 1) {
    const end = paths[0].at(-1)!;
    const [left, right] = arrowHead(paths[0][0], end, object.thickness);
    paths.push([left, end, right]);
  }
  return <g>{paths.map((path, index) => path.length === 1
    ? <circle key={index} cx={path[0].x} cy={path[0].y} r={object.thickness / 2} fill={object.color} />
    : <polyline key={index} points={pathPoints(path)} fill="none" stroke={object.color} strokeWidth={object.thickness}
      strokeLinecap="round" strokeLinejoin="round" />)}</g>;
}

function ImageShape({ box, image }: { box: Box; image: Blob }) {
  const url = useObjectUrl(image);
  if (!url) return null;
  return <image href={url} {...box} y={-box.y - box.height} transform="scale(1 -1)" preserveAspectRatio="none" />;
}

let textMeasureContext: CanvasRenderingContext2D | null | undefined;
function TextShape({ object }: { object: TextOverlay }) {
  const id = useId();
  const { box, text, size, font, bold, align, color } = object;
  const family = fontFaces[font].label;
  const css = `${bold ? '700' : '400'} ${size}px "${family}"`;
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    let live = true;
    void document.fonts.load(css).then(() => { if (live) setLoaded(css); }).catch(() => {});
    return () => { live = false; };
  }, [css]);
  const lines = useMemo(() => {
    if (typeof document !== 'undefined') textMeasureContext ??= document.createElement('canvas').getContext('2d');
    if (textMeasureContext) textMeasureContext.font = loaded === css ? loaded : css;
    return textLines(text, box.width, line => textMeasureContext?.measureText(line).width ?? line.length * size * .55);
  }, [text, box.width, css, size, loaded]);
  const top = -box.y - box.height;
  const x = box.x + (align === 'center' ? box.width / 2 : align === 'right' ? box.width : 0);
  return <g transform="scale(1 -1)" clipPath={`url(#${id})`}>
    <clipPath id={id}><rect {...box} y={top} /></clipPath>
    <text x={x} fill={color} fontFamily={family} fontSize={size} fontWeight={bold ? 700 : 400}
      textAnchor={align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'}>
      {lines.map((line, index) => <tspan key={index} x={x} y={top + size + index * size * 1.2}>{line}</tspan>)}
    </text>
  </g>;
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function snapLines(drag: Box, lines: Box[]) {
  const snapped = lines.flatMap(line => {
    const x = Math.max(line.x, drag.x);
    const right = Math.min(line.x + line.width, drag.x + drag.width);
    const overlap = Math.min(line.y + line.height, drag.y + drag.height) - Math.max(line.y, drag.y);
    return right > x && overlap >= Math.min(line.height * .2, drag.height * .5)
      ? [{ x, y: line.y, width: right - x, height: line.height }] : [];
  });
  return snapped.length ? snapped : [drag];
}

function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fraction = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - dx * fraction, point.y - a.y - dy * fraction);
}
