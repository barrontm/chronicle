import { formatRange, jsDateToDecimalYear, moveDates, precisionOf, toDecimalYear } from '../../model/dates';
import type { EraRegion } from '../../model/eras';
import type { DatedItem, Dimension, HistDate, Relation, TimelineItem } from '../../model/types';
import { bandSummary } from '../representations/era';
import { DEEP_LIMITS, panBy, windowAround, zoomAround, type YearWindow } from '../timeNav';
import { attachGestures } from './gestures';
import {
  AXIS_H, describeEntry, describeEra, describeLane1, eraLanes, eraSpan, ERAS_BACK, HEAD1_H, HEAD_ROW, hitTest, lane1Span, laneAt, layout, maxScroll, PHONE_W, prepare, rowSpan,
  stepActive, stepEra, stepLane1, type LaneInput, type Level, type PEra, type Prepared, type StepKey, type View,
} from './layout';
import { svgPainter } from './paint';
import { FONTS, SPACING, type FontKey, type Link, type Measure, type Scene, type Target } from './scene';

/**
 * The timeline renderer: our own layout, SVG painter and gestures.
 * Only `TimelineView.tsx` imports it. Its control mirrors `TimelineControl` (windows in decimal
 * years), plus a level.
 */

export interface TimelineData {
  items: DatedItem[];
  lanes: LaneInput[];
  prominence?: (id: string) => number;
  thumbFor?: (item: TimelineItem) => string | undefined;
  /** Claude's drafts waiting for Bob, drawn as dashed ghosts. */
  drafts?: DatedItem[];
  /** Connections: a war's battles become ticks on its bar, a work is joined to its maker. */
  relations?: Relation[];
  /** Level 0: the eras in their regions. */
  eras?: EraRegion[];
  /** Level 1: each entry's dimension, its lane inside an era. */
  dimensions?: ReadonlyMap<string, Dimension>;
}

/** New dates for an entry Bob dragged (or moved with Alt and an arrow key). */
export interface MovedDates { start: HistDate; end?: HistDate }

export interface TimelineCallbacks {
  onSelect: (id: string | undefined) => void;
  onAddAt: (year: number, laneId?: string) => void;
  /** The window in view, where the plot sits in the host, and the level, as `VisibleWindow`. */
  onWindow: (w: { start: number; end: number; left: number; width: number; level: Level }) => void;
  /** Bob dragged the playhead, or clicked empty space while it shows. */
  onYear?: (year: number) => void;
  /** Bob dragged the open entry, or one of its ends, to new dates. Without it entries can't be dragged. */
  onMove?: (id: string, dates: MovedDates) => void;
}

export interface TimelineHandle {
  setData(d: TimelineData): void;
  setSelected(id: string | undefined): void;
  /** The open entry's lit connections (role per id; the rest fade) and every arrow to draw. */
  setLinks(roles: Map<string, string> | undefined, links: Link[]): void;
  /** The map's year, or undefined to hide the playhead. */
  setPlayYear(year: number | undefined): void;
  setWindow(w: YearWindow, animate?: boolean): void;
  getWindow(): YearWindow;
  zoomBy(factor: number): void;
  panBy(years: number): void;
  fit(): void;
  level(): Level;
  /** 0 or 2; level 1 opens from an era (clicking it, or zooming in over it), and 0 closes it. */
  setLevel(level: Level): void;
  /** Whether the open era (level 1) shows this entry, so opening it needn't move the window. */
  inEra(id: string): boolean;
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
      w = ctx.measureText(s).width + (SPACING[font] ?? 0) * s.length;
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
  let reported: { start: number; end: number; left: number; width: number; level: Level } | null = null;
  /** Each level keeps its own vertical scroll. */
  const scrolls = new Map<Level, number>();
  let eraById = new Map<string, PEra>();
  let hasData = false;
  let source = new Map<string, DatedItem>();
  let draftKey = '';
  let dims: ReadonlyMap<string, Dimension> = new Map();
  /** Level 1: the window at level 0 before the era opened, to go back to. */
  let before0: YearWindow | null = null;
  /** An era opening (to 1) or closing (to 0). */
  let morph: { from: number; to: number; t0: number | null; fade: boolean } | null = null;
  /** Zoom gestures wait until this time after an era opens or closes, so one pinch doesn't do both. */
  let calm = 0;
  V.editable = !!cb.onMove;

  // Screen readers hear the entry the arrow keys are on through one option node (aria-activedescendant).
  const optionId = `tl-active-${Math.random().toString(36).slice(2, 8)}`;
  const option = document.createElement('div');
  option.id = optionId;
  option.className = 'sr-only';
  option.setAttribute('role', 'option');
  host.setAttribute('role', 'listbox');
  host.append(option);

  /** On a phone, levels 0 and 1 have no gutter: names sit above their rows. */
  const gut = () => (level !== 2 && size.w < PHONE_W ? 0 : size.gutter);
  const maxY = () => maxScroll(D, size.h, level, size.w, V.era);
  /** The level Bob is on: while an era closes, already 0. */
  const shownLevel = (): Level => (morph?.to === 0 ? 0 : level);
  const env = () => ({ w: size.w, h: size.h, gutter: gut(), measure });
  const render = () => {
    if (!size.w || !size.h) return;
    V.scrollY = clamp(V.scrollY, 0, maxY());
    scene = layout(D, V, env(), level);
    painter.draw(scene);
    const w = { start: V.win.start, end: V.win.end, left: size.left + gut(), width: size.w - gut(), level: shownLevel() };
    if (!reported || !sameWin(reported, w) || reported.left !== w.left || reported.width !== w.width || reported.level !== w.level) {
      reported = w;
      cb.onWindow(w);
    }
    if (hasData) host.dataset.ready = '';
    // The level, once nothing is moving (tests wait for it before tapping).
    if (!morph && !tween) host.dataset.level = String(level);
    else delete host.dataset.level;
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
    if (morph && V.zoom) {
      if (morph.t0 === null) morph.t0 = now;
      const p = clamp((now - morph.t0) / MOVE_MS, 0, 1);
      V.zoom.t = morph.from + (morph.to - morph.from) * (morph.fade ? p : ease(p));
      if (p >= 1) {
        const opened = morph.to === 1;
        morph = null;
        if (opened) V.zoom = undefined;
        else closed();
      }
    }
    render();
    if (tween || morph) schedule();
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
  const plotW = () => Math.max(1, size.w - gut());
  const yearAt = (x: number) => V.win.start + ((x - gut()) / plotW()) * (V.win.end - V.win.start);

  /* ---------- pointer ---------- */
  const targetAt = (x: number, y: number): Target | undefined => (scene ? hitTest(scene, x, y) : undefined);
  const hoverKey = (t: Target | undefined) => (!t ? undefined : t.cluster ? `cluster:${t.cluster.lead}` : t.id);

  const describe = (t: Target): { title: string; sub: string } | null => {
    if (t.cluster) {
      const lead = D.byId.get(t.cluster.lead);
      const noun = t.cluster.kind === 'event' ? 'events' : t.cluster.kind === 'person' ? 'people' : 'periods';
      return { title: `${t.cluster.count} ${noun}${lead ? `, among them ${lead.title}` : ''}`, sub: 'Click to zoom in on them' };
    }
    const era = level !== 2 ? eraById.get(t.id) : undefined;
    if (era) return { title: era.title, sub: bandSummary(era) };
    const it = D.byId.get(t.id);
    if (!it) return null;
    if (it.draft) return { title: it.title, sub: `${it.when} · Claude's draft, waiting for you` };
    if (t.grip === 'start' || t.grip === 'end') return { title: it.title, sub: `Drag to change when it ${t.grip === 'start' ? 'starts' : 'ends'}` };
    return { title: it.title, sub: t.grip ? `${it.when} · Drag to change its dates` : it.when };
  };
  let tipKey: string | undefined;
  const showTip = (t: Target | undefined, x: number, y: number) => {
    const d = t && t.id !== 'playhead' ? describe(t) : null;
    if (!d) { tip.hidden = true; tipKey = undefined; return; }
    const key = `${hoverKey(t)}${t?.grip ?? ''}`;
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

  /** What a press grabbed: the playhead, or a part of the open entry (with where the press began). */
  let dragging: { what: 'playhead' } | { what: 'entry'; id: string; part: 'body' | 'start' | 'end'; from: number; y: number; moved?: MovedDates } | null = null;
  const unchanged = (a: MovedDates, it: TimelineItem) => JSON.stringify([a.start, a.end]) === JSON.stringify([it.start, it.end]);
  const detach = attachGestures(host, {
    panPx: (dx) => { tween = null; setWin(panBy(V.win, (-dx / plotW()) * (V.win.end - V.win.start), DEEP_LIMITS)); },
    scrollBy: (dy) => { V.scrollY = clamp(V.scrollY + dy, 0, maxY()); schedule(); },
    zoomAt: (factor, x, y) => {
      if (morph || performance.now() < calm) return;
      // Zooming in over an era opens it; zooming out past an open era's years closes it.
      if (level === 0 && factor < 1) {
        const id = eraAt(x, y);
        if (id) { openEra(id); return; }
      }
      if (level === 1 && V.era && factor > 1) {
        const fitted = fitEra(V.era.era), span = V.win.end - V.win.start, most = fitted.end - fitted.start;
        if (span >= most * 0.98) { closeEra(); return; }
        factor = Math.min(factor, most / span);
      }
      tween = null;
      setWin(zoomAround(V.win, factor, x > gut() ? yearAt(x) : undefined, DEEP_LIMITS));
    },
    tap: (x, y) => {
      if (morph) return;
      const t = targetAt(x, y);
      if (t?.id === 'playhead' || t?.id === HEAD_ROW) return;
      if (t?.id === ERAS_BACK) { closeEra(); return; }
      if (t?.cluster) {
        // Zoom to fit the cluster, so its members have room to split.
        const { s, e } = t.cluster;
        setWin(windowAround((s + e) / 2, Math.max((e - s) * 1.3, 20), DEEP_LIMITS), true);
        return;
      }
      if (t && D.byId.get(t.id)?.draft) return;
      // An era's band opens it into its lanes; its name there opens the era itself.
      if (t && level === 0 && eraById.has(t.id)) { setActive(t.id); openEra(t.id); return; }
      if (t) { setActive(t.id); cb.onSelect(t.id); return; }
      if (y < scene!.plot.y || x < gut()) return;
      cb.onSelect(undefined);
      if (V.playYear !== undefined) cb.onYear?.(Math.round(yearAt(x)));
    },
    doubleTap: (x, y) => {
      if (x < gut() || (scene && y < scene.plot.y) || targetAt(x, y)) return;
      cb.onAddAt(Math.round(yearAt(x)), level === 2 ? laneAt(D, V.scrollY, y)?.id : undefined);
    },
    hover: (x, y) => {
      if (dragging) return;
      const t = targetAt(x, y);
      const key = hoverKey(t);
      const draft = t && D.byId.get(t.id)?.draft;
      host.style.cursor = t?.id === 'playhead' || t?.grip === 'start' || t?.grip === 'end' ? 'ew-resize' : t?.grip ? 'grab' : t && !draft && t.id !== HEAD_ROW ? 'pointer' : '';
      if (key !== V.hover) { V.hover = key === 'playhead' ? undefined : key; schedule(); }
      showTip(t, x, y);
    },
    leave: () => { if (V.hover) { V.hover = undefined; schedule(); } tip.hidden = true; },
    grab: (x, y) => {
      const t = targetAt(x, y);
      V.ring = false;
      dragging = t?.id === 'playhead' && cb.onYear ? { what: 'playhead' }
        : t?.grip && cb.onMove && source.has(t.id) ? { what: 'entry', id: t.id, part: t.grip, from: yearAt(x), y: t.y }
        : null;
      if (dragging) tip.hidden = true;
      if (dragging?.what === 'entry') host.style.cursor = dragging.part === 'body' ? 'grabbing' : 'ew-resize';
      return !!dragging;
    },
    drag: (x) => {
      if (dragging?.what === 'playhead') { cb.onYear?.(yearAt(clamp(x, gut(), size.w))); return; }
      if (dragging?.what !== 'entry') return;
      const it = source.get(dragging.id)!;
      // Dates move in whole steps of how precisely they're known, so the copy snaps as it goes.
      const moved = moveDates(it, yearAt(clamp(x, gut(), size.w)) - dragging.from, dragging.part);
      dragging.moved = moved;
      const s = toDecimalYear(moved.start);
      const e = it.kind === 'event' ? s : moved.end ? toDecimalYear(moved.end) : V.now;
      V.drag = { id: it.id, s, e, label: formatRange(moved.start, moved.end), y: dragging.y };
      schedule();
    },
    release: () => {
      const d = dragging;
      dragging = null;
      host.style.cursor = '';
      if (d?.what !== 'entry') return;
      V.drag = undefined;
      schedule();
      const it = source.get(d.id);
      if (it && d.moved && !unchanged(d.moved, it)) cb.onMove?.(d.id, d.moved);
    },
  });

  /* ---------- keys: arrows through entries and lanes, Enter opens, Shift pans, Alt moves the open entry ---------- */
  const setActive = (id: string | undefined) => {
    V.active = id;
    if (id && D.byId.has(id)) {
      option.textContent = (level === 0 && describeEra(D, id)) || (level === 1 && V.era && describeLane1(V.era, id)) || describeEntry(D, id);
      option.setAttribute('aria-selected', String(id === V.selected));
      host.setAttribute('aria-activedescendant', optionId);
    } else {
      option.textContent = '';
      host.removeAttribute('aria-activedescendant');
    }
    schedule();
  };
  /** Bring an entry into view: its time, and its lane. */
  const reveal = (id: string) => {
    const it = D.byId.get(id);
    if (!it) return;
    const span = V.win.end - V.win.start;
    const pad = span * 0.08;
    if (it.s < V.win.start + pad || it.s > V.win.end - pad) setWin(windowAround(Math.min(it.s + span * 0.3, (it.s + it.e) / 2), span, DEEP_LIMITS), true);
    scrollTo(id, 4);
  };
  /** Scroll an entry's row (at level 0, an era's band) into view. */
  const scrollTo = (id: string, pad: number) => {
    const it = D.byId.get(id);
    const phone = size.w < PHONE_W;
    const ys = level === 0 ? eraSpan(D, id, phone) : level === 1 && V.era ? lane1Span(V.era, id, phone) : it && rowSpan(D, it);
    if (!ys || !size.h) return;
    const [top, bottom] = ys;
    const viewH = size.h - AXIS_H - (level === 1 ? HEAD1_H : 0);
    if (top < V.scrollY) V.scrollY = clamp(top - pad, 0, maxY());
    else if (bottom > V.scrollY + viewH) V.scrollY = clamp(bottom - viewH + pad, 0, maxY());
  };
  /** One step for Alt + arrow: a twentieth of the view, but at least one unit of how precisely the dates are known. */
  const nudge = (it: DatedItem, dir: number): MovedDates => {
    const unit = { year: 1, month: 1 / 12, day: 1 / 365.25 }[precisionOf(it.start)];
    return moveDates(it, dir * Math.max((V.win.end - V.win.start) / 20, unit));
  };
  const STEP_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
  const onKey = (e: KeyboardEvent) => {
    const span = V.win.end - V.win.start;
    const sideways = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (e.key === '+' || e.key === '=') setWin(zoomAround(V.win, 0.5, undefined, DEEP_LIMITS), true);
    else if (e.key === '-') setWin(zoomAround(V.win, 2, undefined, DEEP_LIMITS), true);
    else if (sideways && e.shiftKey) setWin(panBy(V.win, sideways * span * 0.1, DEEP_LIMITS));
    else if (sideways && e.altKey) {
      const it = V.selected ? source.get(V.selected) : undefined;
      if (!it || !cb.onMove) return;
      cb.onMove(it.id, nudge(it, sideways));
    } else if (STEP_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey) {
      const key = e.key as StepKey;
      const id = level === 0 ? stepEra(D, V.active, key, V.win) : level === 1 && V.era ? stepLane1(V.era, V.active, key, V.win) : stepActive(D, V.active, key, V.win);
      if (!id) return;
      V.ring = true;
      reveal(id);
      setActive(id);
    } else if ((e.key === 'Enter' || e.key === ' ') && V.active && D.byId.has(V.active)) {
      if (level === 0 && eraById.has(V.active)) openEra(V.active);
      else cb.onSelect(V.active);
    } else if (e.key === 'Escape' && level === 1) {
      // Esc backs out of the era first; the open panel stays.
      closeEra();
      e.stopPropagation();
    } else if (e.key === 'Escape' && V.selected) cb.onSelect(undefined);
    else return;
    e.preventDefault();
  };
  host.addEventListener('keydown', onKey);
  // The ring shows only while the keyboard is in use.
  const onBlur = () => { if (V.ring) { V.ring = false; schedule(); } };
  host.addEventListener('blur', onBlur);

  /** The window that frames an era, as "All" frames everything. */
  const fitEra = (e: PEra): YearWindow => windowAround((e.s + e.e) / 2, Math.max(e.e - e.s, 10) * 1.08, DEEP_LIMITS);
  const eraAt = (x: number, y: number) => scene?.targets.find((t) => eraById.has(t.id) && x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h)?.id;

  /** Level 0 → 1: the era's band opens into its lanes, framed in time. */
  const openEra = (id: string) => {
    const era = eraById.get(id);
    const EL = era && level === 0 && !morph ? eraLanes(D, id, dims) : undefined;
    if (!era || !EL) return;
    before0 = tween ? tween.to : V.win;
    scrolls.set(0, V.scrollY);
    const fade = reducedMotion();
    level = 1;
    V.era = EL;
    V.zoom = { t: 0, fade, scroll0: V.scrollY };
    V.scrollY = 0;
    V.hover = undefined;
    tip.hidden = true;
    morph = { from: 0, to: 1, t0: null, fade };
    calm = performance.now() + MOVE_MS + 250;
    setWin(fitEra(era), true);
  };
  /** Level 1 → 0: the lanes fold back into the band, and the eras come back as they were. */
  const closeEra = () => {
    if (level !== 1 || morph?.to === 0) return;
    const fade = reducedMotion();
    const t = V.zoom?.t ?? 1;
    V.zoom = { t, fade, scroll0: scrolls.get(0) ?? 0 };
    V.hover = undefined;
    tip.hidden = true;
    morph = { from: t, to: 0, t0: null, fade };
    calm = performance.now() + MOVE_MS + 250;
    if (before0) setWin(before0, true);
    schedule();
  };
  const closed = () => {
    level = 0;
    V.era = undefined;
    V.zoom = undefined;
    V.scrollY = scrolls.get(0) ?? 0;
    before0 = null;
    if (V.active) setActive(D.byId.has(V.active) ? V.active : undefined);
  };

  const switchLevel = (l: Level) => {
    if (level === 1 && l === 0) { closeEra(); return; }
    if (l === 1 || (l === level && !morph)) return;
    if (level === 1) {
      // Straight to the entries: the era's lanes go without folding back.
      morph = null;
      V.era = undefined;
      V.zoom = undefined;
      before0 = null;
    } else scrolls.set(level, V.scrollY);
    level = l;
    V.scrollY = scrolls.get(l) ?? 0;
    V.hover = undefined;
    if (V.active) setActive(D.byId.has(V.active) ? V.active : undefined);
    schedule();
  };

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
  // Spectral SC is only ever drawn in the SVG, so it's asked for here, before level 0 needs it.
  void Promise.all([FONTS.era, FONTS.region].map((f) => document.fonts?.load(f))).then(() => { if (live) { measure.reset(); schedule(); } }, () => {});

  return {
    setData(d) {
      D = prepare(d.items, d.lanes, { now: V.now, prominence: d.prominence, thumbFor: d.thumbFor, drafts: d.drafts, relations: d.relations, eras: d.eras });
      eraById = new Map(D.regions.flatMap((R) => R.eras.map((e) => [e.id, e])));
      dims = d.dimensions ?? new Map();
      // The open era follows the data; if it's gone (deleted, or its category hidden), back to the eras.
      if (level === 1 && V.era) {
        const EL = eraLanes(D, V.era.era.id, dims);
        if (EL) V.era = EL;
        else { morph = null; closed(); }
      }
      source = new Map(d.items.map((i) => [i.id, i]));
      if (V.active) setActive(D.byId.has(V.active) ? V.active : undefined);
      // New drafts from Claude are brought into view, as the map frames them.
      const drafts = (d.drafts ?? []).map((x) => x.id).filter((id) => D.byId.get(id)?.draft).join();
      if (drafts && drafts !== draftKey && size.h) reveal(drafts.split(',')[0]);
      draftKey = drafts;
      hasData = d.items.length > 0;
      if (!hasData) delete host.dataset.ready;
      schedule();
    },
    setSelected(id) {
      V.selected = id;
      // An entry that isn't an era (a landmark, say) opens among the entries, at level 2.
      if (id && level === 0 && D.byId.has(id) && !eraById.has(id)) switchLevel(2);
      // So does one outside the open era.
      if (id && level === 1 && V.era && D.byId.has(id) && id !== V.era.era.id && !V.era.laneOf.has(id)) switchLevel(2);
      // An entry opened anywhere scrolls its row into view (its time is framed by `focus`).
      if (id && D.byId.has(id)) scrollTo(id, 4);
      // The arrow keys carry on from whatever was opened last.
      setActive(id ?? V.active);
    },
    setLinks(roles, links) { V.roles = roles; V.links = links; schedule(); },
    setPlayYear(year) { V.playYear = year; schedule(); },
    setWindow: (w, animate) => setWin(windowAround((w.start + w.end) / 2, w.end - w.start, DEEP_LIMITS), animate),
    getWindow: () => (tween ? tween.to : V.win),
    zoomBy: (f) => setWin(zoomAround(tween?.to ?? V.win, f, undefined, DEEP_LIMITS), true),
    panBy: (years) => setWin(panBy(V.win, years, DEEP_LIMITS)),
    fit() {
      if (shownLevel() === 1 && V.era) { setWin(fitEra(V.era.era), true); return; }
      const x = (shownLevel() === 0 && D.eraExtent) || D.extent;
      if (!x) return;
      const span = Math.max(x.end - x.start, 10);
      setWin(windowAround((x.start + x.end) / 2, span * 1.08, DEEP_LIMITS), true);
    },
    level: shownLevel,
    setLevel: switchLevel,
    inEra: (id) => shownLevel() === 1 && !!V.era && (id === V.era.era.id || V.era.laneOf.has(id)),
    dispose() {
      live = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      detach();
      host.removeEventListener('keydown', onKey);
      host.removeEventListener('blur', onBlur);
      painter.dispose();
      tip.remove();
      option.remove();
      host.removeAttribute('role');
      host.removeAttribute('aria-activedescendant');
      delete host.dataset.ready;
      delete host.dataset.level;
    },
  };
}
