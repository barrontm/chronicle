import { jsDateToDecimalYear } from '../../model/dates';
import type { TimelineItem } from '../../model/types';
import { DEEP_LIMITS, panBy, windowAround, zoomAround, type YearWindow } from '../timeNav';
import { attachGestures } from './gestures';
import { hitTest, laneAt, layout, maxScroll, prepare, type LaneInput, type Level, type Prepared, type View } from './layout';
import { svgPainter } from './paint';
import { FONTS, type FontKey, type Measure, type Scene, type Target } from './scene';

/**
 * The new timeline renderer: our own layout, SVG painter and gestures, in place of vis-timeline.
 * Only `TimelineView.tsx` imports it. Its control mirrors `TimelineControl` (windows in decimal
 * years), plus a level.
 */

export interface TimelineData {
  items: TimelineItem[];
  lanes: LaneInput[];
  prominence?: (id: string) => number;
  thumbFor?: (item: TimelineItem) => string | undefined;
}

export interface TimelineCallbacks {
  onSelect: (id: string | undefined) => void;
  onAddAt: (year: number, laneId?: string) => void;
  /** The window in view and where the plot sits in the host, as `VisibleWindow`. */
  onWindow: (w: { start: number; end: number; left: number; width: number }) => void;
  /** Bob dragged the playhead, or clicked empty space while it shows. */
  onYear?: (year: number) => void;
}

export interface TimelineHandle {
  setData(d: TimelineData): void;
  setSelected(id: string | undefined): void;
  /** The map's year, or undefined to hide the playhead. */
  setPlayYear(year: number | undefined): void;
  setWindow(w: YearWindow, animate?: boolean): void;
  getWindow(): YearWindow;
  zoomBy(factor: number): void;
  panBy(years: number): void;
  fit(): void;
  level(): Level;
  setLevel(level: Level): void;
  dispose(): void;
}

const MOVE_MS = 400;
/** --motion-move's easing, cubic-bezier(.2,.7,.2,1). */
const ease = (() => {
  const bez = (a: number, b: number) => (t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const bx = bez(0.2, 0.2), by = bez(0.7, 1);
  return (x: number) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 20; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; } return by(t); };
})();
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sameWin = (a: YearWindow, b: YearWindow) => a.start === b.start && a.end === b.end;

/** Text widths from one canvas, cached per font. */
function canvasMeasure(): Measure & { reset(): void } {
  const ctx = document.createElement('canvas').getContext('2d');
  const caches = new Map<FontKey, Map<string, number>>();
  let cur = '';
  const m = ((font: FontKey, s: string) => {
    let c = caches.get(font);
    if (!c) caches.set(font, (c = new Map()));
    let w = c.get(s);
    if (w === undefined) {
      if (!ctx) return s.length * 7;
      if (cur !== font) { ctx.font = FONTS[font]; cur = font; }
      w = ctx.measureText(s).width;
      if (c.size > 50_000) c.clear();
      c.set(s, w);
    }
    return w;
  }) as Measure & { reset(): void };
  m.reset = () => { caches.clear(); cur = ''; };
  return m;
}

export function createTimeline(host: HTMLElement, cb: TimelineCallbacks, initial: { window: YearWindow; level?: Level }): TimelineHandle {
  const painter = svgPainter();
  const measure = canvasMeasure();
  const tip = document.createElement('div');
  tip.className = 'tl-tip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  host.append(painter.el, tip);

  let D: Prepared = prepare([], [], { now: 0 });
  const V: View = { win: initial.window, scrollY: 0, now: jsDateToDecimalYear(new Date()) };
  let level: Level = initial.level ?? 2;
  let size = { w: 0, h: 0, gutter: 188, left: 0 };
  let scene: Scene | null = null;
  let raf = 0;
  let tween: { from: YearWindow; to: YearWindow; t0: number | null } | null = null;
  let reported: { start: number; end: number; left: number; width: number } | null = null;
  let hasData = false;

  const env = () => ({ w: size.w, h: size.h, gutter: size.gutter, measure });
  const render = () => {
    if (!size.w || !size.h) return;
    V.scrollY = clamp(V.scrollY, 0, maxScroll(D, size.h));
    scene = layout(D, V, env(), level);
    painter.draw(scene);
    const w = { start: V.win.start, end: V.win.end, left: size.left + size.gutter, width: size.w - size.gutter };
    if (!reported || !sameWin(reported, w) || reported.left !== w.left || reported.width !== w.width) {
      reported = w;
      cb.onWindow(w);
    }
    if (hasData) host.dataset.ready = '';
  };
  const frame = (now: number) => {
    raf = 0;
    if (tween) {
      if (tween.t0 === null) tween.t0 = now;
      const p = clamp((now - tween.t0) / MOVE_MS, 0, 1);
      const e = ease(p);
      V.win = { start: tween.from.start + (tween.to.start - tween.from.start) * e, end: tween.from.end + (tween.to.end - tween.from.end) * e };
      if (p >= 1) tween = null;
    }
    render();
    if (tween) schedule();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };

  const setWin = (w: YearWindow, animate = false) => {
    if (animate && !reducedMotion()) {
      tween = { from: V.win, to: w, t0: null };
    } else {
      tween = null;
      V.win = w;
    }
    schedule();
  };
  const plotW = () => Math.max(1, size.w - size.gutter);
  const yearAt = (x: number) => V.win.start + ((x - size.gutter) / plotW()) * (V.win.end - V.win.start);

  /* ---------- pointer ---------- */
  const targetAt = (x: number, y: number): Target | undefined => (scene ? hitTest(scene, x, y) : undefined);
  const hoverKey = (t: Target | undefined) => (!t ? undefined : t.cluster ? `cluster:${t.cluster.lead}` : t.id);

  const describe = (t: Target): { title: string; sub: string } | null => {
    if (t.cluster) {
      const lead = D.byId.get(t.cluster.lead);
      const noun = t.cluster.kind === 'event' ? 'events' : t.cluster.kind === 'person' ? 'people' : 'periods';
      return { title: `${t.cluster.count} ${noun}${lead ? `, among them ${lead.title}` : ''}`, sub: 'Click to zoom in on them' };
    }
    const it = D.byId.get(t.id);
    return it ? { title: it.title, sub: it.when } : null;
  };
  let tipKey: string | undefined;
  const showTip = (t: Target | undefined, x: number, y: number) => {
    const d = t && t.id !== 'playhead' ? describe(t) : null;
    if (!d) { tip.hidden = true; tipKey = undefined; return; }
    const key = hoverKey(t);
    if (key !== tipKey) {
      tip.replaceChildren();
      const b = document.createElement('b');
      b.textContent = d.title;
      const s = document.createElement('span');
      s.textContent = d.sub;
      tip.append(b, s);
      tipKey = key;
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.transform = `translate(${clamp(x + 12, 4, size.w - tw - 4)}px, ${y + 16}px)`;
  };

  let dragging = false;
  const detach = attachGestures(host, {
    panPx: (dx) => { tween = null; setWin(panBy(V.win, (-dx / plotW()) * (V.win.end - V.win.start), DEEP_LIMITS)); },
    scrollBy: (dy) => { V.scrollY = clamp(V.scrollY + dy, 0, maxScroll(D, size.h)); schedule(); },
    zoomAt: (factor, x) => { tween = null; setWin(zoomAround(V.win, factor, x > size.gutter ? yearAt(x) : undefined, DEEP_LIMITS)); },
    tap: (x, y) => {
      const t = targetAt(x, y);
      if (t?.id === 'playhead') return;
      if (t?.cluster) {
        // Zoom to fit the cluster, so its members have room to split.
        const { s, e } = t.cluster;
        setWin(windowAround((s + e) / 2, Math.max((e - s) * 1.3, 20), DEEP_LIMITS), true);
        return;
      }
      if (t) { cb.onSelect(t.id); return; }
      if (y < scene!.plot.y || x < size.gutter) return;
      cb.onSelect(undefined);
      if (V.playYear !== undefined) cb.onYear?.(Math.round(yearAt(x)));
    },
    doubleTap: (x, y) => {
      if (x < size.gutter || (scene && y < scene.plot.y) || targetAt(x, y)) return;
      cb.onAddAt(Math.round(yearAt(x)), laneAt(D, V.scrollY, y)?.id);
    },
    hover: (x, y) => {
      if (dragging) return;
      const t = targetAt(x, y);
      const key = hoverKey(t);
      host.style.cursor = t?.id === 'playhead' ? 'ew-resize' : t ? 'pointer' : '';
      if (key !== V.hover) { V.hover = key === 'playhead' ? undefined : key; schedule(); }
      showTip(t, x, y);
    },
    leave: () => { if (V.hover) { V.hover = undefined; schedule(); } tip.hidden = true; },
    grab: (x, y) => {
      dragging = targetAt(x, y)?.id === 'playhead' && !!cb.onYear;
      if (dragging) tip.hidden = true;
      return dragging;
    },
    drag: (x) => cb.onYear?.(yearAt(clamp(x, size.gutter, size.w))),
    release: () => { dragging = false; },
  });

  /* ---------- keys: a start; arrow keys through entries and lanes come with ticket 3 ---------- */
  const onKey = (e: KeyboardEvent) => {
    const span = V.win.end - V.win.start;
    if (e.key === '+' || e.key === '=') setWin(zoomAround(V.win, 0.5, undefined, DEEP_LIMITS), true);
    else if (e.key === '-') setWin(zoomAround(V.win, 2, undefined, DEEP_LIMITS), true);
    else if (e.key === 'ArrowLeft') setWin(panBy(V.win, -span * 0.1, DEEP_LIMITS));
    else if (e.key === 'ArrowRight') setWin(panBy(V.win, span * 0.1, DEEP_LIMITS));
    else return;
    e.preventDefault();
  };
  host.addEventListener('keydown', onKey);

  /* ---------- size and fonts ---------- */
  const resize = () => {
    const box = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const w = Math.round(box.width - padL - padR), h = Math.round(host.clientHeight);
    if (!w || !h) return;
    const gutter = parseFloat(cs.getPropertyValue('--lane-label')) || 188;
    size = { w, h, gutter: Math.min(gutter, Math.round(w * 0.4)), left: padL };
    painter.resize(w, h);
    render();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  // Labels are measured again once the fonts arrive, so they aren't cut short by a fallback's widths.
  let live = true;
  void document.fonts?.ready.then(() => { if (live) { measure.reset(); schedule(); } });

  return {
    setData(d) {
      D = prepare(d.items, d.lanes, { now: V.now, prominence: d.prominence, thumbFor: d.thumbFor });
      hasData = d.items.length > 0;
      if (!hasData) delete host.dataset.ready;
      schedule();
    },
    setSelected(id) { V.selected = id; schedule(); },
    setPlayYear(year) { V.playYear = year; schedule(); },
    setWindow: (w, animate) => setWin(windowAround((w.start + w.end) / 2, w.end - w.start, DEEP_LIMITS), animate),
    getWindow: () => (tween ? tween.to : V.win),
    zoomBy: (f) => setWin(zoomAround(tween?.to ?? V.win, f, undefined, DEEP_LIMITS), true),
    panBy: (years) => setWin(panBy(V.win, years, DEEP_LIMITS)),
    fit() {
      const x = D.extent;
      if (!x) return;
      const span = Math.max(x.end - x.start, 10);
      setWin(windowAround((x.start + x.end) / 2, span * 1.08, DEEP_LIMITS), true);
    },
    level: () => level,
    setLevel(l) { level = l; schedule(); },
    dispose() {
      live = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      detach();
      host.removeEventListener('keydown', onKey);
      painter.dispose();
      tip.remove();
      delete host.dataset.ready;
    },
  };
}
