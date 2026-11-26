import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Size } from '../../lib/tools/image/geometry';
import { fitScale, fitView, zoomAt, type Point, type View } from '../../lib/tools/image/preview-view';

interface Touch extends Point { target: EventTarget }
interface Pinch { view: View; center: Point; distance: number }
interface Pan { id: number; view: View; origin: Point; swipe: boolean }

const pinchSample = ([a, b]: Touch[], stage: HTMLElement) => ({
  center: relativePoint(stage, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
  distance: Math.hypot(a.x - b.x, a.y - b.y),
});

function relativePoint(stage: HTMLElement, point: Point): Point {
  const rect = stage.getBoundingClientRect();
  return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 };
}

function pointerPoint(event: PointerEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

export function usePreviewView(stage: HTMLDivElement | null, size: Size | undefined, file: string | undefined,
  onSwipe?: (direction: number) => void) {
  const [view, setView] = useState<View>(fitView);
  const [viewport, setViewport] = useState<Size>();
  const [panning, setPanning] = useState(false);
  const current = useRef(view);
  const space = useRef(false);
  const spacePan = useRef(false);
  const touches = useRef(new Map<number, Touch>());
  const pan = useRef<Pan | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const cancellingTouch = useRef(false);
  const scaleAtFit = size && viewport ? fitScale(size, viewport) : 1;
  const oneToOne = 1 / scaleAtFit;

  function update(next: View) {
    current.current = next;
    setView(next);
  }

  useEffect(() => {
    update(fitView);
    pan.current = pinch.current = null;
    touches.current.clear();
    setPanning(false);
  }, [file]);

  useEffect(() => {
    if (!stage) return;
    // The canvas plane is inset by 12 CSS pixels on each side.
    const measure = () => setViewport({ width: Math.max(1, stage.clientWidth - 24), height: Math.max(1, stage.clientHeight - 24) });
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
    if (!target) return;
      if (target instanceof Element && target.closest('input, textarea, select, [role=slider], [contenteditable]')) return;
      space.current = true;
      // Preserve normal page scrolling until the canvas has keyboard focus.
      if (stage && target instanceof Element && stage.contains(target) && !target.closest('button, a')) event.preventDefault();
    }
    function clearSpace(event?: KeyboardEvent) {
      if (event && event.code !== 'Space') return;
      if (spacePan.current) event?.preventDefault();
      space.current = spacePan.current = false;
    }
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', clearSpace);
    const blur = () => clearSpace();
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', clearSpace);
      window.removeEventListener('blur', blur);
    };
  }, [stage]);

  function limit(scale: number) {
    return Math.min(Math.max(8, oneToOne * 2), Math.max(Math.min(0.25, oneToOne / 4), scale));
  }

  useEffect(() => {
    if (!stage || !size) return;
    let trackpad: { view: View; center: Point } | undefined;
    const bounded = (scale: number) => Math.min(Math.max(8, oneToOne * 2), Math.max(Math.min(0.25, oneToOne / 4), scale));
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 160 : 1);
      const point = relativePoint(stage, { x: event.clientX, y: event.clientY });
      const view = current.current;
      update(zoomAt(view, bounded(view.scale * Math.exp(-delta * 0.002)), point));
    };
    // Safari reports some trackpad pinches as GestureEvents instead of wheel.
    const gesture = (event: Event) => {
      event.preventDefault();
      const { scale, clientX, clientY } = event as MouseEvent & { scale: number };
      const center = relativePoint(stage, { x: clientX, y: clientY });
      if (event.type === 'gesturestart') trackpad = { view: current.current, center };
      else if (event.type === 'gestureend') trackpad = undefined;
      else if (trackpad) update(zoomAt(trackpad.view, bounded(trackpad.view.scale * scale), trackpad.center, center));
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) stage.addEventListener(type, gesture);
    return () => {
      stage.removeEventListener('wheel', wheel);
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) stage.removeEventListener(type, gesture);
    };
  }, [stage, size, oneToOne]);

  function capture(event: PointerEvent, id = event.pointerId) {
    if (event.isTrusted && event.type === 'pointerdown') (event.currentTarget as HTMLElement).setPointerCapture(id);
    event.stopPropagation();
    event.preventDefault();
  }

  function pointerDown(event: PointerEvent) {
    if (!size) return;
    const point = pointerPoint(event);
    const target = event.target;
    if (!target) return;
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { ...point, target });
      if (touches.current.size > 1) {
        if (touches.current.size === 2) {
          const [first] = touches.current.keys();
          cancellingTouch.current = true;
          try {
            if (!pan.current) touches.current.get(first)?.target.dispatchEvent(new PointerEvent('pointercancel', {
              bubbles: true, pointerId: first, pointerType: 'touch',
            }));
          } finally {
            cancellingTouch.current = false;
          }
          capture(event, first);
          pinch.current = { ...pinchSample([...touches.current.values()], event.currentTarget as HTMLElement), view: current.current };
          pan.current = null;
          setPanning(true);
        }
        capture(event);
        return;
      }
    }
    const editing = target instanceof Element && Boolean(target.closest('.blur-editor, .crop-editor'));
    const overSlider = target instanceof Element && Boolean(target.closest('[data-slot=slider]'));
    const override = event.button === 1 || (event.button === 0 && space.current);
    if (pan.current || (!override && (event.button !== 0 || editing || overSlider))) return;
    const view = current.current;
    if (override && space.current) spacePan.current = true;
    pan.current = {
      id: event.pointerId, origin: point, view,
      swipe: event.pointerType === 'touch' && view === fitView && Boolean(onSwipe),
    };
    capture(event);
    setPanning(true);
  }

  function pointerMove(event: PointerEvent) {
    const point = pointerPoint(event);
    const touch = touches.current.get(event.pointerId);
    if (touch) touches.current.set(event.pointerId, { ...point, target: touch.target });
    if (touch && pinch.current) {
      if (touches.current.size < 2) return;
      const start = pinch.current;
      const { center, distance } = pinchSample([...touches.current.values()], event.currentTarget as HTMLElement);
      update(zoomAt(start.view, limit(start.view.scale * distance / Math.max(1, start.distance)), start.center, center));
      capture(event);
    } else if (pan.current?.id === event.pointerId) {
      const { origin, view } = pan.current;
      update({ ...view, x: view.x + point.x - origin.x, y: view.y + point.y - origin.y });
      capture(event);
    }
  }

  function pointerEnd(event: PointerEvent) {
    if (cancellingTouch.current) return;
    const touch = touches.current.delete(event.pointerId);
    if (touch && pinch.current) {
      capture(event);
      if (!touches.current.size) {
        pinch.current = null;
        setPanning(false);
      }
    } else if (pan.current?.id === event.pointerId) {
      const { origin, swipe } = pan.current;
      pan.current = null;
      setPanning(false);
      const dx = event.clientX - origin.x;
      if (swipe && event.type === 'pointerup' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(event.clientY - origin.y)) {
        update(fitView);
        onSwipe?.(dx < 0 ? 1 : -1);
      }
      capture(event);
    }
  }

  const actual = () => update({ scale: oneToOne, x: 0, y: 0 });
  const reset = () => update(fitView);
  const down = useEffectEvent(pointerDown);
  const move = useEffectEvent(pointerMove);
  const end = useEffectEvent(pointerEnd);
  const doubleClick = useEffectEvent((event: MouseEvent) => {
    if (!size || !(event.target instanceof Element) || event.target.closest('button, [data-slot=slider]')) return;
    if (current.current === fitView) actual();
    else reset();
  });
  useEffect(() => {
    if (!stage) return;
    // Listen on the physical canvas so captured gestures reach portaled tools.
    stage.addEventListener('pointerdown', down, true);
    stage.addEventListener('pointermove', move, true);
    stage.addEventListener('pointerup', end, true);
    stage.addEventListener('pointercancel', end, true);
    stage.addEventListener('dblclick', doubleClick, true);
    return () => {
      stage.removeEventListener('pointerdown', down, true);
      stage.removeEventListener('pointermove', move, true);
      stage.removeEventListener('pointerup', end, true);
      stage.removeEventListener('pointercancel', end, true);
      stage.removeEventListener('dblclick', doubleClick, true);
    };
  }, [stage]);

  return {
    view, percent: Math.round(view.scale * scaleAtFit * 100), panning,
    atFit: view === fitView, atActualSize: view !== fitView && view.scale === oneToOne,
    zoom: (factor: number) => {
      const view = current.current;
      update(zoomAt(view, limit(view.scale * factor), { x: 0, y: 0 }));
    },
    actual, reset,
  };
}
