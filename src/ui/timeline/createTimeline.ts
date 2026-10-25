import { jsDateToDecimalYear, formatRange, moveDates, precisionOf, toDecimalYear } from '../../model/dates';
import { describeEffect } from '../../model/doc';
import type { EraRegion } from '../../model/eras';
import type { LensMarks } from '../../model/lenses';
import type { Overview } from '../../model/overview';
import type { DatedItem, HistDate, Lane, Relation } from '../../model/types';
import { bandSummary, chipSummary, parseThemeKey } from '../representations/era';
import { ARROW, RIBBON } from '../representations/influence';
import type { Thread } from '../../model/threads';
import { PIGMENT } from '../util';
import { DEEP_LIMITS, panBy, windowAround, zoomAround, type YearWindow } from '../timeNav';
import { attachGestures } from './gestures';
import {
  AXIS_H, blockSpan, describeEra, describeLane1, eraLanes, eraSpan, FOLD, hasThreads, hitBox, hitTest, INERT, layout, maxScroll, openSpan, parseToggle,
  PHONE_W, polityLanes, prepare, regionSpan, revealIn, stripSpan, stepEra, stepLane1, THEMES_MORE, type EraLanes, type LaneInput, type PEra, type Prepared, type StepKey, type View,
} from './layout';
import { svgPainter } from './paint';
import { FONTS, SPACING, type FontKey, type Link, type Measure, type Scene, type Target } from './scene';

/**
 * The timeline renderer: our own layout, SVG painter and gestures.
 * Only `TimelineView.tsx` imports it. Its control mirrors `TimelineControl` (windows in decimal
 * years), plus what's open in place.
 */

export interface TimelineData {
  items: DatedItem[];
  /** The categories shown: entries in a hidden one leave the timeline. */
  lanes: LaneInput[];
  prominence?: (id: string) => number;
  /** Claude's drafts waiting for Bob, drawn as dashed ghosts in the lanes they'd sit in. */
  drafts?: DatedItem[];
  relations?: Relation[];
  /** The eras in their regions: the overview's backdrop, and what opens from a wash. */
  eras?: EraRegion[];
  /** The overview's bands, polities, world events and top row. */
  overview?: Overview;
  /** Each entry's lanes (`entryLanes`), for its lanes inside an era or a polity. */
  entryLanes?: ReadonlyMap<string, readonly Lane[]>;
  /** What's in a polity (`pol:<territory>`) or a world event (its id), drafts too. */
  membersOf?: (pick: string) => readonly string[];
  /** Connections rolled up by polity or era (`threads`). */
  threads?: readonly Thread[];
  /** Each region's entries per lane, for the lenses (`lensMarks`). */
  lenses?: LensMarks;
}

/** New dates for an entry Bob dragged (or moved with Alt and an arrow key). */
export interface MovedDates { start: HistDate; end?: HistDate }

export interface TimelineCallbacks {
  onSelect: (id: string | undefined) => void;
  onAddAt: (year: number) => void;
  /** Bob pressed a lane's "Add": a new entry in that lane, dated the middle of the years in view, part of what's open (`partOf`). */
  onAddIn?: (lane: Lane, year: number, partOf?: string) => void;
  /** The window in view, and where the plot sits in the host, as `VisibleWindow`. */
  onWindow: (w: { start: number; end: number; left: number; width: number }) => void;
  /** Bob dragged the playhead, or clicked empty space while it shows. */
  onYear?: (year: number) => void;
  /** Bob dragged the open entry, or one of its ends, to new dates. Without it entries can't be dragged. */
  onMove?: (id: string, dates: MovedDates) => void;
  /** Bob box-selected entries (Ctrl or ⌘ and drag), or added or removed one (Ctrl or ⌘ and click), or cleared them (Esc): the whole selection. Without it nothing can be box-selected. */
  onPick?: (ids: string[]) => void;
  /** What the overview has picked or open changed (the map follows it). */
  onFocus?: (f: OverviewFocus) => void;
  /** Bob let go of the region focused from the map (Esc). */
  onRegion?: (region: string | undefined) => void;
  /** Bob clicked an arrow between lanes (or its line on the phone): open that connection. */
  onOpenRelation?: (id: string) => void;
  /** Bob clicked a ribbon: list its connections (`title` names the two rows it joins). */
  onOpenThread?: (t: { ids: string[]; title: string }) => void;
  /** Bob folded or unfolded a group: the groups now open, to remember. */
  onUnfold?: (ids: string[]) => void;
  /** Bob opened or folded lanes in place: what's open now (`pol:<territory>`, world events' and eras' ids), to remember. */
  onOpen?: (keys: string[]) => void;
}

/** What the overview has picked (`pol:<territory>` or a world event's id), whether its lanes are open, and its open lane with what's in it. */
export interface OverviewFocus { pick?: string; open?: boolean; lane?: Lane; laneIds?: string[] }

export interface TimelineHandle {
  setData(d: TimelineData): void;
  setSelected(id: string | undefined): void;
  /** The entries box-selected for bulk edit, ringed. */
  setPicked(ids: readonly string[]): void;
  /** The open entry's lit connections (role per id; the rest fade) and every arrow to draw. */
  setLinks(roles: Map<string, string> | undefined, links: Link[]): void;
  /** The map's year, or undefined to hide the playhead. */
  setPlayYear(year: number | undefined): void;
  setWindow(w: YearWindow, animate?: boolean): void;
  getWindow(): YearWindow;
  zoomBy(factor: number): void;
  panBy(years: number): void;
  fit(): void;
  /** Whether the timeline draws this entry (in open lanes, or on the overview itself). */
  shows(id: string): boolean;
  /** Focus a region of the overview (Bob clicked it on the map): its rows grown and in view. */
  setRegion(region: string | undefined): void;
  /** "Show all threads", every ribbon faintly (laptop only). */
  setAllThreads(all: boolean): void;
  /** The lenses on, a strip of each lane's ticks under every band. */
  setLenses(lanes: readonly Lane[]): void;
  /** The groups shown open (remembered from before), without the unfolding motion. */
  setUnfolded(ids: readonly string[]): void;
  /** What's open in place (remembered from before), without the unfurling motion. */
  setOpened(keys: readonly string[]): void;
  dispose(): void;
}

const MOVE_MS = 400;
/** Room kept above open lanes for the strip they opened from. */
const STRIP_ROOM = 48;
/** How long the pointer rests on a strip before its threads take over from the ones lit. */
const THREAD_DWELL = 220;
/** --motion-move's easing, cubic-bezier(.2,.7,.2,1). */
const ease = (() => {
  const bez = (a: number, b: number) => (t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const bx = bez(0.2, 0.2), by = bez(0.7, 1);
  return (x: number) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 20; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; } return by(t); };
})();
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sameWin = (a: YearWindow, b: YearWindow) => a.start === b.start && a.end === b.end;
/** A lane's pigment (umber for "No lane yet"), for an entry dragged in it. */
const laneColor = (lane: string | undefined) => `var(--pig-${PIGMENT[(lane ?? 'none') as keyof typeof PIGMENT] ?? 'umber'})`;

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

export function createTimeline(host: HTMLElement, cb: TimelineCallbacks, initial: { window: YearWindow }): TimelineHandle {
  const painter = svgPainter();
  const measure = canvasMeasure();
  const tip = document.createElement('div');
  tip.className = 'tl-tip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  host.append(painter.el, tip);

  let D: Prepared = prepare([], [], { now: 0 });
  const V: View = { win: initial.window, scrollY: 0, now: jsDateToDecimalYear(new Date()) };
  let size = { w: 0, h: 0, gutter: 188, left: 0 };
  let scene: Scene | null = null;
  let raf = 0;
  let tween: { from: YearWindow; to: YearWindow; t0: number | null } | null = null;
  let reported: { start: number; end: number; left: number; width: number } | null = null;
  /** Where the rows were scrolled to while lanes unfurl, so the scroll isn't cut short before they've grown. */
  let wantY: number | null = null;
  let eraById = new Map<string, PEra>();
  let hasData = false;
  /** Whether the window has been framed on what there is yet (the first time there's anything). */
  let framed = false;
  let source = new Map<string, DatedItem>();
  let draftKey = '';
  let dims: ReadonlyMap<string, readonly Lane[]> = new Map();
  let membersOf: (pick: string) => readonly string[] = () => [];
  V.editable = !!cb.onMove;
  /** The selection for bulk edit, as App has it; while a box is drawn, `V.picked` also shows what it touches. */
  let picked: ReadonlySet<string> = new Set();

  /* ---------- lanes open in place ---------- */
  /** What's open, in the order opened, with its lanes; and how far each is open while it moves. */
  const opened = new Map<string, EraLanes>();
  const openT = new Map<string, number>();
  const unfurls = new Map<string, { from: number; to: number; t0: number | null }>();
  V.opened = opened;
  V.openT = openT;
  /** What Bob wants open (remembered), including what can't be built until the data arrives. */
  let wanted: string[] = [];
  const folding = (key: string) => unfurls.get(key)?.to === 0;
  /** What's open and staying open, most recently opened last. */
  const openKeys = () => [...opened.keys()].filter((k) => !folding(k));
  const lanesFor = (key: string): EraLanes | undefined => (eraById.has(key) ? eraLanes(D, key, dims) : polityLanes(D, key, membersOf(key), dims));
  const remember = () => { wanted = openKeys(); cb.onOpen?.(wanted); };
  const openKey = (key: string, animate = true) => {
    const EL = opened.get(key) ?? lanesFor(key);
    if (!EL) return false;
    // The most recently opened goes last, so Esc folds it first.
    const from = folding(key) || opened.has(key) ? openT.get(key) ?? 1 : 0;
    opened.delete(key);
    opened.set(key, EL);
    V.openFade = reducedMotion();
    if (animate && from < 1) { openT.set(key, from); unfurls.set(key, { from, to: 1, t0: null }); }
    else { unfurls.delete(key); openT.delete(key); }
    V.hover = undefined;
    tip.hidden = true;
    schedule();
    return true;
  };
  const foldKey = (key: string) => {
    if (!opened.has(key) || folding(key)) return;
    // Folding lanes scrolled past keeps what they were opened from in view.
    const ys = blockSpan(D, V, key, env());
    if (ys && ys[0] < V.scrollY + 40) V.scrollY = Math.max(0, ys[0] - 80);
    const from = openT.get(key) ?? 1;
    V.openFade = reducedMotion();
    unfurls.set(key, { from, to: 0, t0: null });
    if (V.theme && opened.get(key)?.themes.some((x) => `${x.era}:${x.theme.id}` === V.theme!.key)) V.theme = undefined;
    V.hover = undefined;
    tip.hidden = true;
    schedule();
  };
  /** Lanes opening low in the view scroll up into it, what they opened from staying in view. */
  const bringIn = (key: string) => {
    const ys = blockSpan(D, V, key, env()), viewH = size.h - AXIS_H;
    if (!ys) return;
    const want = ys[0] + Math.min(ys[1] - ys[0], viewH * 0.6);
    if (want <= V.scrollY + viewH) return;
    V.scrollY = clamp(Math.min(ys[0] - STRIP_ROOM, want - viewH), 0, Math.max(0, ys[1] - viewH + 8));
    wantY = V.scrollY;
  };
  const toggleOpen = (key: string) => {
    if (opened.has(key) && !folding(key)) foldKey(key);
    else if (openKey(key)) bringIn(key);
    remember();
  };
  /** The open lanes Bob is working in: the pick's, else the last opened. */
  const focusBlock = (): [string, EraLanes] | undefined => {
    const keys = openKeys();
    const key = V.pick && keys.includes(V.pick) ? V.pick : keys[keys.length - 1];
    return key ? [key, opened.get(key)!] : undefined;
  };

  /** What the map was last told the overview has picked or open. */
  let focusKey = '';
  const reportFocus = () => {
    const EL = V.pick && opened.has(V.pick) && !folding(V.pick) ? opened.get(V.pick) : undefined;
    const lane = EL?.compact && EL.open && EL.open !== 'none' ? EL.open : undefined;
    const f: OverviewFocus = { pick: V.pick, open: !!EL?.compact, lane, laneIds: lane ? EL!.lanes.find((l) => l.id === lane)?.order.filter((x) => !x.draft).map((x) => x.id) : undefined };
    const key = JSON.stringify(f);
    if (key === focusKey) return;
    focusKey = key;
    cb.onFocus?.(f);
  };

  // Screen readers hear the entry the arrow keys are on through one option node (aria-activedescendant).
  const optionId = `tl-active-${Math.random().toString(36).slice(2, 8)}`;
  const option = document.createElement('div');
  option.id = optionId;
  option.className = 'sr-only';
  option.setAttribute('role', 'option');
  host.setAttribute('role', 'listbox');
  host.append(option);

  // "+ Add" under each open lane's name: real buttons over the drawing, so Tab and Enter reach them.
  const adds = document.createElement('div');
  adds.className = 'tl-adds';
  host.append(adds);
  const addButtons = new Map<string, HTMLButtonElement>();
  // Presses on a button are its own, not the timeline's taps, drags or keys.
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown'] as const) adds.addEventListener(type, (e) => e.stopPropagation());
  const addIn = (lane: Lane, block: string) => {
    const EL = opened.get(block);
    if (!EL || unfurls.has(block)) return;
    const win = tween ? tween.to : V.win;
    const pol = block.startsWith('pol:') ? block.slice(4) : undefined;
    // In a polity, part of the polity itself (its territory), so it reads "Part of Athens".
    cb.onAddIn?.(lane, Math.round((win.start + win.end) / 2), pol ?? EL.head.opens);
  };
  const placeAdds = (S: Scene) => {
    const spots = cb.onAddIn ? S.adds.filter((a) => a.block) : [];
    for (const a of spots) {
      const id = `${a.block}|${a.lane}`;
      let b = addButtons.get(id);
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'tl-add';
        b.textContent = '+ Add';
        b.dataset.lane = a.lane;
        b.dataset.block = a.block;
        b.addEventListener('click', () => addIn(a.lane, a.block!));
        addButtons.set(id, b);
      }
      const title = opened.get(a.block!)?.head.title;
      b.setAttribute('aria-label', `Add to ${a.label}${title ? ` in ${title}` : ''}`);
      b.title = `Add an entry to ${a.label}`;
      b.style.transform = `translate(${size.left + a.x}px, ${a.y}px)`;
      b.style.width = `${a.w}px`;
      b.style.height = `${a.h}px`;
    }
    // In lane order, so Tab goes down the lanes; those scrolled out of view leave.
    const order = spots.map((a) => addButtons.get(`${a.block}|${a.lane}`)!);
    if (order.length !== adds.children.length || order.some((b, i) => adds.children[i] !== b)) {
      const focused = order.find((b) => b === document.activeElement);
      adds.replaceChildren(...order);
      focused?.focus({ preventScroll: true });
    }
  };

  /** On a phone there's no gutter: names sit above their rows. */
  const gut = () => (size.w < PHONE_W ? 0 : size.gutter);
  const env = () => ({ w: size.w, h: size.h, gutter: gut(), measure });
  const maxY = () => maxScroll(D, size.h, env(), V);
  const render = () => {
    if (!size.w || !size.h) return;
    if (wantY !== null) V.scrollY = wantY;
    V.scrollY = clamp(V.scrollY, 0, maxY());
    if (!unfurls.size && !folds.size) wantY = null;
    scene = layout(D, V, env());
    painter.draw(scene);
    placeAdds(scene);
    const w = { start: V.win.start, end: V.win.end, left: size.left + gut(), width: size.w - gut() };
    if (!reported || !sameWin(reported, w) || reported.left !== w.left || reported.width !== w.width) {
      reported = w;
      cb.onWindow(w);
    }
    if (hasData) host.dataset.ready = '';
    reportFocus();
    // What's open, and whether anything is moving (tests wait for it to settle before tapping).
    host.dataset.open = openKeys().join(' ');
    if (!tween && !folds.size && !unfurls.size) host.dataset.settled = '';
    else delete host.dataset.settled;
  };
  /** Groups folding or unfolding on the overview. */
  const folds = new Map<string, { from: number; to: number; t0: number | null }>();
  const unfolded = new Map<string, number>();
  V.unfolded = unfolded;
  const frame = (now: number) => {
    raf = 0;
    for (const [id, f] of folds) {
      if (f.t0 === null) f.t0 = now;
      const p = clamp((now - f.t0) / MOVE_MS, 0, 1);
      unfolded.set(id, f.from + (f.to - f.from) * ease(p));
      if (p >= 1) { folds.delete(id); if (!f.to) unfolded.delete(id); }
    }
    for (const [key, f] of unfurls) {
      if (f.t0 === null) f.t0 = now;
      const p = clamp((now - f.t0) / MOVE_MS, 0, 1);
      openT.set(key, f.from + (f.to - f.from) * (V.openFade ? p : ease(p)));
      if (p < 1) continue;
      unfurls.delete(key);
      openT.delete(key);
      if (!f.to) {
        opened.delete(key);
        if (V.active && !shows(V.active)) setActive(undefined);
      }
    }
    if (tween) {
      if (tween.t0 === null) tween.t0 = now;
      const p = clamp((now - tween.t0) / MOVE_MS, 0, 1);
      const e = ease(p);
      V.win = { start: tween.from.start + (tween.to.start - tween.from.start) * e, end: tween.from.end + (tween.to.end - tween.from.end) * e };
      if (p >= 1) tween = null;
    }
    render();
    if (tween || folds.size || unfurls.size) schedule();
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
  /** Frame years with a little room either side, as "All" does. */
  const fitTo = (x: YearWindow, animate: boolean) => setWin(windowAround((x.start + x.end) / 2, Math.max(x.end - x.start, 10) * 1.08, DEEP_LIMITS), animate);
  const plotW = () => Math.max(1, size.w - gut());
  /** Pointers are measured from the host's edge, the drawing from inside its padding. */
  const yearAt = (x: number) => V.win.start + ((x - size.left - gut()) / plotW()) * (V.win.end - V.win.start);

  /** Whether the timeline draws this entry: in lanes open (and staying open), or on the overview itself. */
  const shows = (id: string) => {
    if (eraById.has(id) || D.top.some((x) => x.id === id) || D.byId.get(id)?.world) return true;
    for (const p of D.polById.values()) if (p.itemId === id) return true;
    return openKeys().some((k) => { const EL = opened.get(k)!; return EL.laneOf.has(id) || EL.head.opens === id; });
  };
  /**
   * What to open to show an entry that isn't drawn: the polity it's in (the one Bob has made most
   * of), else a world event it's part of, else the innermost era it's in.
   */
  const ownerOf = (id: string): string | undefined => {
    let best: string | undefined, score = -Infinity;
    for (const p of D.polById.values()) {
      const key = `pol:${p.id}`, members = membersOf(key);
      if (!members.includes(id)) continue;
      const sc = (p.itemId ? D.prominence(p.itemId) : 0) + members.length / 1000;
      if (sc > score) { best = key; score = sc; }
    }
    if (best) return best;
    for (const it of D.byId.values()) if (it.world && membersOf(it.id).includes(id)) return it.id;
    const eras = [...eraById.values()].filter((e) => e.members.includes(id)).sort((a, b) => a.e - a.s - (b.e - b.s));
    return eras[0]?.id;
  };

  /* ---------- pointer ---------- */
  const targetAt = (x: number, y: number): Target | undefined => {
    const t = scene ? hitTest(scene, x - size.left, y) : undefined;
    return t?.id === INERT ? undefined : t;
  };
  const isStrip = (id: string) => id.startsWith('pol:') || !!D.byId.get(id)?.world;

  const describe = (t: Target): { title: string; sub: string } | null => {
    if (t.id.startsWith(THEMES_MORE)) {
      const EL = opened.get(t.id.slice(THEMES_MORE.length));
      return { title: EL?.allThemes ? 'Show fewer themes' : 'Show all the themes', sub: `${EL?.themes.length ?? 0} themes` };
    }
    if (t.id.startsWith(FOLD)) {
      const EL = opened.get(t.id.slice(FOLD.length));
      return EL ? { title: `Fold ${EL.head.title}`, sub: 'Its lanes fold back under it' } : null;
    }
    if (t.id.startsWith(RIBBON)) {
      const r = scene?.ribbons?.get(t.id);
      return r ? { title: r.title, sub: `${r.ids.length} ${r.ids.length === 1 ? 'connection' : 'connections'} · Click to list them` } : null;
    }
    if (t.id.startsWith(ARROW)) {
      const rid = t.id.slice(ARROW.length);
      const x = [...opened.values()].flatMap((EL) => EL.influences).find((i) => i.r.id === rid);
      const a = x && D.byId.get(x.r.fromId), b = x && D.byId.get(x.r.toId);
      return x && a && b ? { title: `${a.title} ${describeEffect(x.r, 'out').toLowerCase()} ${b.title}`, sub: 'Click to see the evidence' } : null;
    }
    const chip = parseThemeKey(t.id);
    if (chip) {
      const th = eraById.get(chip.era)?.themes.find((x) => x.id === chip.theme);
      const on = V.theme?.key === `${chip.era}:${chip.theme}`;
      return th ? { title: th.label, sub: `${chipSummary(th)} · ${on ? 'Click to show everything again' : 'Click to fade everything outside it'}` } : null;
    }
    const era = t.lane !== 'head' ? eraById.get(t.id) : undefined;
    if (era) return { title: era.title, sub: `${bandSummary(era)} · ${opened.has(era.id) && !folding(era.id) ? 'Click to fold its lanes' : 'Click to open its lanes'}` };
    const pol = t.id.startsWith('pol:') ? D.polById.get(t.id.slice(4)) : undefined;
    if (pol) return { title: pol.fullTitle, sub: `${pol.when} · ${pol.t.strength?.length ? 'As strong as your strength points say' : pol.unknown ? 'Size unknown: draw its borders to size it' : 'As wide as its borders'}` };
    const group = t.id.startsWith('grp:') ? D.groupById.get(t.id.slice(4)) : undefined;
    if (group) return { title: group.title, sub: `${group.members.map((m) => m.title).join(', ')} · ${unfolded.get(group.id) ? 'Click to fold them' : 'Click to show each'}` };
    const it = D.byId.get(t.id);
    if (!it) return null;
    if (it.world && t.lane !== 'head' && !t.lane) return { title: it.title, sub: `${it.when} · World event` };
    if (it.draft) return { title: it.title, sub: `${it.when} · Claude's draft, waiting for you` };
    if (t.grip === 'start' || t.grip === 'end') return { title: it.title, sub: `Drag to change when it ${t.grip === 'start' ? 'starts' : 'ends'}` };
    return { title: it.title, sub: t.grip ? `${it.when} · Drag to change its dates` : it.when };
  };
  let tipKey: string | undefined;
  const showTip = (t: Target | undefined, x: number, y: number) => {
    const d = t && t.id !== 'playhead' ? describe(t) : null;
    if (!d) { tip.hidden = true; tipKey = undefined; return; }
    const key = `${t!.id}${t?.grip ?? ''}`;
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

  let threadTimer = 0;
  const hoverThreads = (key: string | undefined) => {
    clearTimeout(threadTimer);
    if (key === V.threadHover) return;
    threadTimer = window.setTimeout(() => { V.threadHover = key; schedule(); }, V.threadHover ? THREAD_DWELL : 0);
  };

  /** What a press grabbed: the playhead, or a part of the open entry (with where the press began). */
  let dragging: { what: 'playhead' } | { what: 'entry'; id: string; part: 'body' | 'start' | 'end'; from: number; y: number; color: string; moved?: MovedDates } | null = null;
  const unchanged = (a: MovedDates, it: DatedItem) => JSON.stringify([a.start, a.end]) === JSON.stringify([it.start, it.end]);
  const detach = attachGestures(host, {
    panPx: (dx) => { tween = null; setWin(panBy(V.win, (-dx / plotW()) * (V.win.end - V.win.start), DEEP_LIMITS)); },
    scrollBy: (dy) => { wantY = null; V.scrollY = clamp(V.scrollY + dy, 0, maxY()); schedule(); },
    zoomAt: (factor, x) => {
      tween = null;
      setWin(zoomAround(V.win, factor, x - size.left > gut() ? yearAt(x) : undefined, DEEP_LIMITS));
    },
    tap: (x, y, mod) => {
      const t = targetAt(x, y);
      if (mod) { if (cb.onPick) togglePick(t); return; }
      if (t?.id === 'playhead') return;
      if (t?.id.startsWith(FOLD)) { foldKey(t.id.slice(FOLD.length)); remember(); return; }
      const toggle = t && parseToggle(t.id);
      if (toggle) { toggleLane(toggle[0], toggle[1]); return; }
      if (t?.id.startsWith(ARROW)) { cb.onOpenRelation?.(t.id.slice(ARROW.length)); return; }
      if (t?.id.startsWith(RIBBON)) { const r = scene?.ribbons?.get(t.id); if (r) cb.onOpenThread?.(r); return; }
      if (t?.id.startsWith(THEMES_MORE)) {
        const EL = opened.get(t.id.slice(THEMES_MORE.length));
        if (EL) { EL.allThemes = !EL.allThemes; V.scrollY = clamp(V.scrollY, 0, maxY()); schedule(); }
        return;
      }
      // A theme chip picks its theme (opening its era first, from the overview), or lets go of it.
      const chip = t && parseThemeKey(t.id);
      if (chip) {
        const key = `${chip.era}:${chip.theme}`;
        if (V.theme?.key === key) { pickTheme(undefined); return; }
        if (!openKeys().some((k) => opened.get(k)!.themes.some((x) => `${x.era}:${x.theme.id}` === key)) && openKey(chip.era)) { bringIn(chip.era); remember(); }
        pickTheme(key);
        return;
      }
      if (t && D.byId.get(t.id)?.draft) return;
      if (t && !t.lane) {
        // A group unfolds into its members, and its bracket folds it back.
        if (t.id.startsWith('grp:')) { toggleGroup(t.id.slice(4)); return; }
        // A strip or a world event is picked (the map follows it), and its lanes unfurl under it, or fold.
        if (isStrip(t.id)) { V.pick = t.id; toggleOpen(t.id); return; }
        // An era's wash opens its lanes under its band; its name there opens the era itself.
        if (eraById.has(t.id)) { setActive(t.id); toggleOpen(t.id); return; }
      }
      if (t) { setActive(t.id); cb.onSelect(t.id); return; }
      if (y < scene!.plot.y || x - size.left < gut()) return;
      if (V.pick || V.threadHover) { V.pick = undefined; V.threadHover = undefined; schedule(); }
      cb.onSelect(undefined);
      if (V.playYear !== undefined) cb.onYear?.(Math.round(yearAt(x)));
    },
    doubleTap: (x, y) => {
      // A quick second click on anything is the first one's; only on empty space does it add.
      if (x - size.left < gut() || (scene && y < scene.plot.y) || targetAt(x, y)) return;
      cb.onAddAt(Math.round(yearAt(x)));
    },
    hover: (x, y) => {
      if (dragging) return;
      const t = targetAt(x, y);
      const key = t?.id;
      const draft = t && D.byId.get(t.id)?.draft;
      host.style.cursor = t?.id === 'playhead' || t?.grip === 'start' || t?.grip === 'end' ? 'ew-resize' : t?.grip ? 'grab' : t && !draft ? 'pointer' : '';
      if (key !== V.hover) { V.hover = key === 'playhead' ? undefined : key; schedule(); }
      // Threads follow the strip, group or era hovered that has some, once the pointer rests there a moment,
      // so crossing other strips on the way to a ribbon leaves them lit.
      hoverThreads(key && hasThreads(D, key) ? key : V.threadHover);
      showTip(t, x, y);
    },
    leave: () => { clearTimeout(threadTimer); if (V.hover || V.threadHover) { V.hover = undefined; V.threadHover = undefined; schedule(); } tip.hidden = true; },
    grab: (x, y) => {
      const t = targetAt(x, y);
      V.ring = false;
      dragging = t?.id === 'playhead' && cb.onYear ? { what: 'playhead' }
        : t?.grip && cb.onMove && source.has(t.id) ? { what: 'entry', id: t.id, part: t.grip, from: yearAt(x), y: t.y, color: laneColor(t.lane) }
        : null;
      if (dragging) tip.hidden = true;
      if (dragging?.what === 'entry') host.style.cursor = dragging.part === 'body' ? 'grabbing' : 'ew-resize';
      return !!dragging;
    },
    drag: (x) => {
      if (dragging?.what === 'playhead') { cb.onYear?.(yearAt(clamp(x, size.left + gut(), size.left + size.w))); return; }
      if (dragging?.what !== 'entry') return;
      const it = source.get(dragging.id)!;
      // Dates move in whole steps of how precisely they're known, so the copy snaps as it goes.
      const moved = moveDates(it, yearAt(clamp(x, size.left + gut(), size.left + size.w)) - dragging.from, dragging.part);
      dragging.moved = moved;
      const s = toDecimalYear(moved.start);
      const e = it.kind === 'event' ? s : moved.end ? toDecimalYear(moved.end) : V.now;
      V.drag = { id: it.id, s, e, label: formatRange(moved.start, moved.end), y: dragging.y, color: dragging.color };
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
    box: (x0, y0, x1, y1) => {
      if (!cb.onPick) return;
      V.box = { x: x0 - size.left, y: y0, w: x1 - x0, h: y1 - y0 };
      tip.hidden = true;
      // What the box touches lights up as it grows.
      V.picked = scene ? new Set([...picked, ...hitBox(scene, D, V.box)]) : picked;
      schedule();
    },
    boxEnd: (cancel) => {
      const b = V.box;
      V.box = undefined;
      V.picked = picked;
      schedule();
      if (!b || cancel || !scene || !cb.onPick) return;
      const hit = hitBox(scene, D, b);
      if (hit.length) cb.onPick([...new Set([...picked, ...hit])]);
    },
  });
  const toggleGroup = (id: string) => {
    const now = unfolded.get(id) ?? 0, to = folds.get(id)?.to === 1 || (!folds.has(id) && now >= 0.5) ? 0 : 1;
    if (reducedMotion()) { folds.delete(id); if (to) unfolded.set(id, 1); else unfolded.delete(id); }
    else folds.set(id, { from: now, to, t0: null });
    const open = new Set([...unfolded.keys(), ...folds.keys()].filter((g) => (folds.has(g) ? folds.get(g)!.to === 1 : (unfolded.get(g) ?? 0) >= 0.5)));
    cb.onUnfold?.([...open]);
    V.hover = undefined;
    tip.hidden = true;
    schedule();
  };
  /** Ctrl or ⌘ and click: an entry goes in, or out if it was in. */
  const togglePick = (t: Target | undefined) => {
    if (!t || !D.byId.has(t.id) || D.byId.get(t.id)!.draft) return;
    const next = new Set(picked);
    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
    cb.onPick?.([...next]);
  };
  /** A theme chip picked (`<era>:<theme>`), or let go of. Everything outside it fades. */
  const pickTheme = (key: string | undefined) => {
    const [era, id] = key?.split(':') ?? [];
    const th = eraById.get(era)?.themes.find((x) => x.id === id);
    V.theme = th ? { key: key!, ids: new Set(th.ids) } : undefined;
    schedule();
  };
  /** A polity's lane opens to all its entries, or closes back to ticks; the one open before closes. */
  const toggleLane = (key: string, id: string) => {
    const EL = opened.get(key);
    if (!EL?.compact || unfurls.has(key)) return;
    const lane = id as NonNullable<EraLanes['open']>;
    EL.open = EL.open === lane ? undefined : lane;
    // The map follows the lanes Bob is working in.
    V.pick = key;
    V.hover = undefined;
    tip.hidden = true;
    schedule();
  };

  /* ---------- keys: arrows through entries and lanes, Enter opens, Shift pans, Alt moves the open entry ---------- */
  const setActive = (id: string | undefined) => {
    V.active = id;
    if (id && D.byId.has(id)) {
      const EL = [...opened.values()].find((x) => x.laneOf.has(id));
      option.textContent = (eraById.has(id) && describeEra(D, id)) || (EL && describeLane1(EL, id)) || `${D.byId.get(id)!.title}, ${D.byId.get(id)!.when}`;
      option.setAttribute('aria-selected', String(id === V.selected));
      host.setAttribute('aria-activedescendant', optionId);
    } else {
      option.textContent = '';
      host.removeAttribute('aria-activedescendant');
    }
    schedule();
  };
  /** Bring an entry into view: its time (keeping the span), and its row. */
  const reveal = (id: string) => {
    const it = D.byId.get(id);
    if (!it) return;
    const w = tween ? tween.to : V.win;
    const span = w.end - w.start;
    const pad = span * 0.08;
    if (it.s < w.start + pad || it.s > w.end - pad) setWin(windowAround(Math.min(it.s + span * 0.3, (it.s + it.e) / 2), span, DEEP_LIMITS), true);
    scrollTo(id, 4);
  };
  /** Scroll an entry's row in open lanes (an era's band, for an era) into view. */
  const scrollTo = (id: string, pad: number) => {
    const pol = [...D.polById.values()].find((p) => p.itemId === id);
    const ys = eraById.has(id) && !opened.has(id) ? eraSpan(D, V, id, env()) : pol ? stripSpan(D, V, pol.id, env()) : openSpan(D, V, id, env());
    if (!ys || !size.h) return;
    const [top, bottom] = ys;
    const viewH = size.h - AXIS_H;
    // Measured as it'll be once open, so lanes still unfurling don't cut it short.
    const most = maxScroll(D, size.h, env(), { ...V, openT: undefined });
    const y = V.scrollY;
    if (top < y) V.scrollY = clamp(top - pad, 0, most);
    else if (bottom > y + viewH) V.scrollY = clamp(bottom - viewH + pad, 0, most);
    if (V.scrollY !== y) { wantY = V.scrollY; schedule(); }
  };
  /** Open what an entry is in, if it isn't drawn yet, then bring it into view. */
  const showEntry = (id: string) => {
    if (!shows(id)) {
      const key = ownerOf(id);
      if (!key || !openKey(key)) return;
      remember();
    }
    // In a polity's closed lane it may not be named: its lane opens.
    for (const k of openKeys()) if (revealIn(opened.get(k)!, id)) break;
    reveal(id);
  };
  /** The open lanes, top to bottom, for the arrow keys. */
  const openInOrder = () => openKeys()
    .map((k) => [blockSpan(D, V, k, env())?.[0] ?? 0, opened.get(k)!] as const)
    .sort((a, b) => a[0] - b[0]).map(([, EL]) => EL);
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
      // Through the entries in open lanes; with none open, through the eras.
      const key = e.key as StepKey;
      const ELs = openInOrder().filter((EL) => EL.lanes.some((l) => l.order.some((x) => !x.draft)));
      const id = ELs.length ? stepLane1(ELs, V.active, key, V.win) : stepEra(D, V.active, key, V.win);
      if (!id) return;
      V.ring = true;
      reveal(id);
      setActive(id);
    } else if ((e.key === 'Enter' || e.key === ' ') && V.active && D.byId.has(V.active)) {
      if (eraById.has(V.active) && !opened.has(V.active)) { openKey(V.active); remember(); }
      else cb.onSelect(V.active);
    } else if (e.key === 'Escape' && picked.size && cb.onPick) {
      // Esc lets go of a box-selection first.
      cb.onPick([]);
      e.stopPropagation();
    } else if (e.key === 'Escape' && V.region && cb.onRegion) {
      // Esc lets go of the region focused from the map, before anything else it holds.
      cb.onRegion(undefined);
      e.stopPropagation();
    } else if (e.key === 'Escape' && focusBlock()) {
      // Esc closes an open lane first, then folds the lanes opened last; the open panel stays, and so does the pick.
      const [key, EL] = focusBlock()!;
      if (EL.open) toggleLane(key, EL.open);
      else { foldKey(key); remember(); }
      e.stopPropagation();
    } else if (e.key === 'Escape' && (V.pick || V.threadHover)) {
      // Esc lets go of the picked strip, and of the threads lit up.
      V.pick = undefined;
      V.threadHover = undefined;
      schedule();
      e.stopPropagation();
    } else if (e.key === 'Escape' && V.selected) cb.onSelect(undefined);
    else return;
    e.preventDefault();
  };
  host.addEventListener('keydown', onKey);
  // The ring shows only while the keyboard is in use.
  const onBlur = () => { if (V.ring) { V.ring = false; schedule(); } };
  host.addEventListener('blur', onBlur);

  /* ---------- size and fonts ---------- */
  const resize = () => {
    const box = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const w = Math.round(box.width - padL - padR), h = Math.round(host.clientHeight);
    if (!w || !h) return;
    const gutter = parseFloat(cs.getPropertyValue('--lane-label')) || 188;
    const was = size.w;
    size = { w, h, gutter: Math.min(gutter, Math.round(w * 0.4)), left: padL };
    painter.resize(w, h);
    // Narrower or wider (a panel opened beside it, say), the open entry stays in view.
    if (was && was !== w && V.selected && shows(V.selected)) scrollTo(V.selected, 4);
    render();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  // Labels are measured again once the fonts arrive, so they aren't cut short by a fallback's widths.
  let live = true;
  void document.fonts?.ready.then(() => { if (live) { measure.reset(); schedule(); } });
  // Spectral SC is only ever drawn in the SVG, so it's asked for here, before the overview needs it.
  void Promise.all([FONTS.era, FONTS.region].map((f) => document.fonts?.load(f))).then(() => { if (live) { measure.reset(); schedule(); } }, () => {});

  return {
    setData(d) {
      D = prepare(d.items, d.lanes, { now: V.now, prominence: d.prominence, drafts: d.drafts, relations: d.relations, eras: d.eras, overview: d.overview, threads: d.threads, lenses: d.lenses });
      // A pick whose strip or world event has gone lets go.
      if (V.pick && !D.polById.has(V.pick.slice(4)) && !D.byId.get(V.pick)?.world) V.pick = undefined;
      eraById = new Map(D.regions.flatMap((R) => R.eras.map((e) => [e.id, e])));
      dims = d.entryLanes ?? new Map();
      membersOf = d.membersOf ?? (() => []);
      // Open lanes follow the data; any whose polity, world event or era has gone (or is hidden) fold away.
      for (const [key, old] of [...opened]) {
        const EL = lanesFor(key);
        if (EL) { EL.open = old.open; EL.allThemes = old.allThemes; opened.set(key, EL); }
        else { opened.delete(key); openT.delete(key); unfurls.delete(key); }
      }
      // What Bob had open last time opens once there's something to open.
      for (const key of wanted) if (!opened.has(key)) openKey(key, false);
      pickTheme(V.theme?.key);
      source = new Map(d.items.map((i) => [i.id, i]));
      if (V.active) setActive(D.byId.has(V.active) ? V.active : undefined);
      // New drafts from Claude are brought into view (their polity opens), as the map frames them.
      const drafts = (d.drafts ?? []).map((x) => x.id).filter((id) => D.byId.get(id)?.draft).join();
      if (drafts && drafts !== draftKey && size.h) showEntry(drafts.split(',')[0]);
      draftKey = drafts;
      hasData = d.items.length > 0;
      if (!hasData) delete host.dataset.ready;
      // The first time there's something to show, the timeline opens on all of it.
      if (!framed && D.overviewExtent) { framed = true; fitTo(D.overviewExtent, false); }
      schedule();
    },
    setSelected(id) {
      V.selected = id;
      // An entry opened anywhere (search, the map, a link) opens what it's in, if need be, and comes into view.
      if (id && D.byId.has(id)) showEntry(id);
      // The arrow keys carry on from whatever was opened last.
      setActive(id ?? V.active);
    },
    setPicked(ids) {
      picked = new Set(ids);
      if (!V.box) V.picked = picked;
      schedule();
    },
    setLinks(roles, links) { V.roles = roles; V.links = links; schedule(); },
    setPlayYear(year) { V.playYear = year; schedule(); },
    setWindow: (w, animate) => setWin(windowAround((w.start + w.end) / 2, w.end - w.start, DEEP_LIMITS), animate),
    getWindow: () => (tween ? tween.to : V.win),
    zoomBy: (f) => setWin(zoomAround(tween?.to ?? V.win, f, undefined, DEEP_LIMITS), true),
    panBy: (years) => setWin(panBy(V.win, years, DEEP_LIMITS)),
    fit() { if (D.overviewExtent) fitTo(D.overviewExtent, true); },
    shows,
    setAllThreads(all) { if (all !== !!V.allThreads) { V.allThreads = all; schedule(); } },
    setLenses(lanes) {
      if ((V.lenses ?? []).join() === lanes.join()) return;
      V.lenses = lanes.length ? [...lanes] : undefined;
      schedule();
    },
    setUnfolded(ids) {
      const want = new Set(ids);
      for (const id of [...unfolded.keys()]) if (!want.has(id) && !folds.has(id)) unfolded.delete(id);
      for (const id of want) if (!folds.has(id)) unfolded.set(id, 1);
      schedule();
    },
    setOpened(keys) {
      if (keys.join() === wanted.join()) return;
      wanted = [...keys];
      const want = new Set(keys);
      for (const key of [...opened.keys()]) if (!want.has(key) && !unfurls.has(key)) { opened.delete(key); openT.delete(key); }
      for (const key of keys) if (!opened.has(key)) openKey(key, false);
      schedule();
    },
    setRegion(region) {
      if (region === V.region) return;
      V.region = region;
      if (region) host.dataset.region = region;
      else delete host.dataset.region;
      if (region) {
        // Its band in the middle of the view (or its top, if it's taller).
        const ys = regionSpan(D, V, region, env());
        if (ys) {
          const view = size.h - AXIS_H, h = ys[1] - ys[0];
          const target = h > view ? ys[0] : ys[0] - (view - h) / 2;
          V.scrollY = clamp(target, 0, maxY());
        }
      }
      schedule();
    },
    dispose() {
      live = false;
      cancelAnimationFrame(raf);
      clearTimeout(threadTimer);
      ro.disconnect();
      detach();
      host.removeEventListener('keydown', onKey);
      host.removeEventListener('blur', onBlur);
      painter.dispose();
      tip.remove();
      option.remove();
      adds.remove();
      host.removeAttribute('role');
      delete host.dataset.open;
      delete host.dataset.settled;
    },
  };
}
