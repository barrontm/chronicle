/**
 * The new timeline's input, on plain Pointer Events (no d3-zoom; see docs/spikes/timeline.md):
 *   wheel or trackpad swipe   move through time
 *   Shift + wheel             scroll the lanes
 *   Ctrl/⌘ + wheel, pinch     zoom around the pointer (a trackpad pinch arrives as Ctrl + wheel)
 *   drag                      move through time and scroll the lanes
 *   tap, double-tap           pick, add
 *   Ctrl/⌘ + drag, + tap      draw a box to select what it touches, add or remove one (mouse and pen)
 * A drag that starts on something draggable (the playhead) goes to `drag` instead of panning.
 */
export interface GestureApi {
  panPx(dx: number): void;
  scrollBy(dy: number): void;
  /** factor 2 = twice as many years in view; x and y in px from the host's top left. */
  zoomAt(factor: number, x: number, y: number): void;
  /** `mod`: Ctrl or ⌘ was held, so it adds or removes one from the selection. */
  tap(x: number, y: number, mod?: boolean): void;
  doubleTap(x: number, y: number): void;
  hover(x: number, y: number): void;
  leave(): void;
  /** Whether a press at this point starts a drag of its own. */
  grab(x: number, y: number): boolean;
  drag(x: number): void;
  release(): void;
  /** The box from where the press began to the pointer, while Ctrl or ⌘ is held. */
  box(x0: number, y0: number, x1: number, y1: number): void;
  /** The box is let go (or dropped, when a second finger lands). */
  boxEnd(cancel: boolean): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wheelPx = (e: WheelEvent) => (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
/** A pinch gives small deltas, a mouse notch about 100: capped so one notch is a gentle step. */
const zoomFactor = (e: WheelEvent) => Math.exp(clamp(e.deltaY * wheelPx(e), -40, 40) * 0.01);

/** Movement below this many px still counts as a tap. */
const TAP_SLOP = 5;
const TAP_MS = 600;
/** A second tap within this time and distance is a double-tap. */
const DOUBLE_MS = 350;
const DOUBLE_PX = 24;

export function attachGestures(el: HTMLElement, api: GestureApi): () => void {
  const ptrs = new Map<number, { x: number; y: number }>();
  let press: { x: number; y: number; t: number; moved: number; grabbed: boolean; boxing: boolean } | null = null;
  let pinchD = 0;
  let lastTap: { x: number; y: number; t: number } | null = null;
  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    const k = wheelPx(e);
    if (e.ctrlKey || e.metaKey) api.zoomAt(zoomFactor(e), p.x, p.y);
    // Some browsers turn Shift + wheel sideways; either way it scrolls the lanes.
    else if (e.shiftKey) api.scrollBy((Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * k);
    else api.panPx(-(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * k);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    el.setPointerCapture?.(e.pointerId);
    const p = local(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) {
      const boxing = (e.ctrlKey || e.metaKey) && e.pointerType !== 'touch';
      press = { ...p, t: performance.now(), moved: 0, boxing, grabbed: !boxing && api.grab(p.x, p.y) };
    }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      if (press?.grabbed) api.release();
      if (press?.boxing) api.boxEnd(true);
      if (press) { press.moved = Infinity; press.grabbed = false; press.boxing = false; }
    }
  };
  const onMove = (e: PointerEvent) => {
    const p = local(e);
    const prev = ptrs.get(e.pointerId);
    if (!prev) { if (e.pointerType === 'mouse') api.hover(p.x, p.y); return; }
    if (ptrs.size === 1 && press) {
      const dx = p.x - prev.x, dy = p.y - prev.y;
      press.moved += Math.abs(dx) + Math.abs(dy);
      if (press.boxing) { if (press.moved > TAP_SLOP) api.box(press.x, press.y, p.x, p.y); }
      else if (press.grabbed) api.drag(p.x);
      else if (press.moved > TAP_SLOP) { api.panPx(dx); api.scrollBy(-dy); }
    } else if (ptrs.size === 2) {
      const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)![1];
      const d = Math.hypot(p.x - other.x, p.y - other.y);
      const mid = (p.x + other.x) / 2, prevMid = (prev.x + other.x) / 2;
      api.panPx(mid - prevMid);
      if (pinchD > 0 && d > 0) api.zoomAt(pinchD / d, mid, (p.y + other.y) / 2);
      pinchD = d;
    }
    ptrs.set(e.pointerId, p);
  };
  const onUp = (e: PointerEvent) => {
    const p = local(e);
    const wasTap = ptrs.size === 1 && press && press.moved <= TAP_SLOP && performance.now() - press.t < TAP_MS;
    if (press?.grabbed && ptrs.size === 1) api.release();
    const boxed = press?.boxing && ptrs.size === 1;
    if (boxed && !wasTap) api.boxEnd(e.type === 'pointercancel');
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) press = null;
    if (!wasTap || e.type === 'pointercancel') return;
    if (boxed) { lastTap = null; api.tap(p.x, p.y, true); return; }
    const now = performance.now();
    if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_PX) {
      lastTap = null;
      api.doubleTap(p.x, p.y);
      return;
    }
    lastTap = { ...p, t: now };
    api.tap(p.x, p.y);
  };
  const onLeave = (e: PointerEvent) => { if (e.pointerType === 'mouse') api.leave(); };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);
  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('pointerleave', onLeave);
  };
}
