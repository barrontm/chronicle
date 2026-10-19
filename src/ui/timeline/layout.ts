import { axisTicks, formatRange, formatYear, toDecimalYear } from '../../model/dates';
import { ELSEWHERE, type Era, type EraRegion } from '../../model/eras';
import { LANES, type DatedItem, type Lane, type Relation, type TimelineItem } from '../../model/types';
import { anchors, arcCurve, loopCurve, type Box as Edges } from '../influenceLinks';
import { makerOf, markOf, representationOf, warOf, type Representation } from '../representations';
import { BAND_H, bandPrims, LANDMARK, LANDMARK_Y } from '../representations/era';
import type { YearWindow } from '../timeNav';
import { LANE_LABEL, PIGMENT } from '../util';
import { tint, type Box, type Cluster, type Link, type MarkKind, type Measure, type Prim, type Scene, type Target } from './scene';

/**
 * The new timeline's layout: pure. `prepare` runs once per data change (lanes, rows, sorted
 * indexes); `layout` runs every frame and returns only what is visible.
 *
 * Level 0 is the eras: a row per region, each era a band (`representations/era.ts`). Level 1 is
 * one era opened into its six lanes (`eraLanes`). Level 2 is single entries in
 * category lanes.
 */

export type Level = 0 | 1 | 2;

export const AXIS_H = 44;
/** Every row is a hit target at least this tall (spans and points need 24 px to tap). */
export const ROW_H = 28;
export const MIN_HIT = 24;
/** A moment drawn as its kind's glyph is this many px across. */
export const GLYPH = 16;
/** Moments closer than this many px merge into a cluster. */
export const CLUSTER_PX = 16;
/** Spans narrower than this many px, this close together, merge into a cluster. */
export const TINY_PX = 4;
/** A lane stacks its moments in up to this many rows before they have to share. */
export const MOMENT_ROWS = 3;
/** The open entry's ends can be dragged within this many px of them. */
export const GRIP_PX = 8;
const PAD_TOP = 6;
const PAD_BOTTOM = 8;
const LANE_MIN = 44;
/** Labels shorter than this are hidden rather than cut short (docs/design.md, Density). */
const MIN_LABEL = 48;
const UMBER = 'var(--pig-umber)';

export interface LaneInput { id: string; label: string; color: string }

export interface PItem {
  id: string;
  /** Its mark: a moment, a span or a life. */
  kind: MarkKind;
  /** How its kind of thing is drawn. */
  rep: Representation;
  title: string;
  /** Its dates in words, for the tooltip; `dates` without "c." for where a dashed edge already says so. */
  when: string;
  dates: string;
  s: number;
  e: number;
  approx: boolean;
  endApprox: boolean;
  /** A life without an end yet (drawn to today): its end can't be dragged. */
  open: boolean;
  /** Claude's draft, waiting for Bob: a dashed umber ghost that can't be opened or moved. */
  draft: boolean;
  lane: number;
  /** Spans: the row inside the lane. */
  row: number;
  /** Spans: where the next span in the same row starts (Infinity if none), so a label can sit after this one. */
  nextS: number;
  thumb?: string;
  /** A battle drawn as a tick on this war's bar instead of a point of its own. */
  war?: string;
  /** A war: its battles' ticks, earliest first. */
  ticks?: PItem[];
  /** A work: the lifeline it's joined to. */
  maker?: string;
}

export interface PLane {
  id: string;
  label: string;
  color: string;
  /** Moments sorted by date, with their dates for binary search. */
  events: PItem[];
  ES: Float64Array;
  /** Spans and lives sorted by start, with starts and the running maximum of ends. */
  spans: PItem[];
  S: Float64Array;
  PM: Float64Array;
  /** Every entry (not drafts) by start, the order the arrow keys go in. */
  order: PItem[];
  spanRows: number;
  momentRows: number;
  /** Offset from the top of the lanes, and height, in px. */
  top: number;
  height: number;
}

/** An era at level 0: the row it sits in inside its region, and its landmarks, most prominent first. */
export interface PEra extends Era { row: number; landmarks: PItem[] }
export interface PRegion {
  name: string;
  /** Its name, or "Elsewhere". */
  label: string;
  highlights: number;
  eras: PEra[];
  rows: number;
}

export interface Prepared {
  lanes: PLane[];
  byId: Map<string, PItem>;
  contentH: number;
  prominence: (id: string) => number;
  /** From the earliest start to the latest end, for "Show everything". */
  extent?: YearWindow;
  /** Level 0: regions with their eras, and the years they cover. */
  regions: PRegion[];
  eraExtent?: YearWindow;
}

export interface PrepareOptions {
  /** Where lives without an end stop: today, as a decimal year. */
  now: number;
  prominence?: (id: string) => number;
  thumbFor?: (item: TimelineItem) => string | undefined;
  /** Claude's drafts waiting for Bob, drawn as ghosts in their lanes. */
  drafts?: DatedItem[];
  /** Connections, for a war's battles (ticks on its bar) and a work's maker (the lifeline it's joined to). */
  relations?: Relation[];
  /** Level 0: the eras in their regions (`eraRegions`). */
  eras?: EraRegion[];
}

export function prepare(items: DatedItem[], lanes: LaneInput[], o: PrepareOptions): Prepared {
  const byId = new Map<string, PItem>();
  const laneIx = new Map(lanes.map((l, i) => [l.id, i]));
  const per: PItem[][] = lanes.map(() => []);
  const refs = new Map<string, DatedItem>();
  let lo = Infinity, hi = -Infinity;
  const add = (ref: DatedItem, draft: boolean) => {
    const li = laneIx.get(ref.categoryId);
    if (li === undefined || byId.has(ref.id)) return;
    const s = toDecimalYear(ref.start);
    // A living person, or a place still there, has no end; draw them up to today.
    const e = ref.kind === 'event' ? s : ref.end ? toDecimalYear(ref.end) : o.now;
    const p: PItem = {
      id: ref.id, kind: markOf(ref), rep: representationOf(ref), title: ref.title, when: formatRange(ref.start, ref.end),
      dates: formatRange({ ...ref.start, approx: undefined }, ref.end && { ...ref.end, approx: undefined }),
      s, e: Math.max(e, s), approx: !!ref.start.approx, endApprox: !!ref.end?.approx, open: ref.kind !== 'event' && !ref.end, draft,
      lane: li, row: 0, nextS: Infinity, thumb: draft ? undefined : o.thumbFor?.(ref),
    };
    byId.set(p.id, p);
    if (!draft) refs.set(p.id, ref);
  };
  for (const ref of items) add(ref, false);
  for (const ref of o.drafts ?? []) add(ref, true);
  // A battle that is part of a war in view is a tick on the war's bar, in the war's lane.
  const rels = o.relations ?? [];
  for (const [bid, wid] of warOf([...refs.values()], rels)) {
    const b = byId.get(bid)!, w = byId.get(wid)!;
    b.war = wid;
    b.lane = w.lane;
    (w.ticks ??= []).push(b);
  }
  for (const w of byId.values()) w.ticks?.sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
  const dated = [...refs.values()].map((r) => ({ ...r, s: byId.get(r.id)!.s, e: byId.get(r.id)!.e }));
  for (const [wid, pid] of makerOf(dated, rels)) byId.get(wid)!.maker = pid;
  for (const p of byId.values()) {
    per[p.lane].push(p);
    if (p.draft) continue;
    lo = Math.min(lo, p.s);
    hi = Math.max(hi, p.e);
  }
  let top = 0;
  const out = lanes.map((l, li): PLane => {
    const events = per[li].filter((i) => i.kind === 'event' && !i.war).sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
    const spans = per[li].filter((i) => i.kind !== 'event').sort((a, b) => a.s - b.s || b.e - a.e || a.id.localeCompare(b.id));
    // Pack into rows by time only, so rows stay put while zooming: periods first, then lives,
    // so each row holds one kind and slivers of it can merge into one cluster.
    const rowEnd: number[] = [];
    const rowLast: PItem[] = [];
    for (const kind of ['span', 'person'] as const) {
      const first = rowEnd.length;
      for (const it of spans) {
        if (it.kind !== kind) continue;
        let r = rowEnd.findIndex((end, i) => i >= first && end <= it.s);
        if (r < 0) r = rowEnd.length;
        if (rowLast[r]) rowLast[r].nextS = it.s;
        rowEnd[r] = it.e;
        rowLast[r] = it;
        it.row = r;
      }
    }
    const S = new Float64Array(spans.length), PM = new Float64Array(spans.length);
    let mx = -Infinity;
    spans.forEach((it, i) => { S[i] = it.s; mx = Math.max(mx, it.e); PM[i] = mx; });
    const momentRows = Math.min(MOMENT_ROWS, events.length);
    const height = Math.max(LANE_MIN, PAD_TOP + (momentRows + rowEnd.length) * ROW_H + PAD_BOTTOM);
    const order = per[li].filter((i) => !i.draft).sort((a, b) => a.s - b.s || a.e - b.e || a.id.localeCompare(b.id));
    const lane: PLane = { ...l, events, ES: Float64Array.from(events, (e) => e.s), spans, S, PM, order, spanRows: rowEnd.length, momentRows, top, height };
    top += height;
    return lane;
  });
  const prominence = o.prominence ?? (() => 0);
  return { lanes: out, byId, contentH: top, prominence, extent: lo <= hi ? { start: lo, end: hi } : undefined, ...prepareEras(o.eras ?? [], byId, prominence) };
}

/**
 * Level 0's rows. Inside a region, eras pack into rows by time only (so rows stay put while
 * zooming), outer eras above the eras inside them. Landmarks are an era's entries that Bob has
 * made something of, most prominent first.
 */
function prepareEras(input: EraRegion[], byId: Map<string, PItem>, prominence: (id: string) => number): Pick<Prepared, 'regions' | 'eraExtent'> {
  let lo = Infinity, hi = -Infinity;
  const regions = input.map((r): PRegion => {
    const shown = r.eras.filter((e) => byId.has(e.id) && !byId.get(e.id)!.draft);
    const ids = new Set(shown.map((e) => e.id));
    const byEra = new Map(shown.map((e) => [e.id, e]));
    const depth = (e: Era) => { let d = 0; for (let p = e.parent; p && ids.has(p) && d < 50; p = byEra.get(p)!.parent) d++; return d; };
    const eras = shown.map((e): PEra => ({
      ...e, row: 0,
      landmarks: e.members.map((id) => byId.get(id)).filter((p): p is PItem => !!p && !p.draft && prominence(p.id) > 0)
        .sort((a, b) => prominence(b.id) - prominence(a.id) || a.s - b.s || a.id.localeCompare(b.id)),
    }));
    const rowEnd: number[] = [];
    const levels = [...new Set(eras.map(depth))].sort((a, b) => a - b);
    for (const d of levels) {
      const first = rowEnd.length;
      for (const e of eras) {
        if (depth(e) !== d) continue;
        let row = rowEnd.findIndex((end, i) => i >= first && end <= e.s);
        if (row < 0) row = rowEnd.length;
        rowEnd[row] = e.e;
        e.row = row;
      }
    }
    for (const e of eras) { lo = Math.min(lo, e.s); hi = Math.max(hi, e.e); }
    return { name: r.name, label: r.name === ELSEWHERE ? 'Elsewhere' : r.name, highlights: r.highlights, eras, rows: rowEnd.length };
  }).filter((r) => r.eras.length);
  return { regions, eraExtent: lo <= hi ? { start: lo, end: hi } : undefined };
}

/* ---------- level 0 geometry ---------- */

/** Below this width level 0 has no gutter: each region's name sits above its row. */
export const PHONE_W = 600;
const REGION_PAD = 8;
/** The gap between region rows, kept free for threads (Phase 4). */
const REGION_GAP = 18;
const BAND_GAP = 4;
const HEAD_H = 24;

const regionH = (R: PRegion, phone: boolean) => (phone ? HEAD_H : 0) + REGION_PAD * 2 + R.rows * BAND_H + (R.rows - 1) * BAND_GAP;
const erasH = (D: Prepared, phone: boolean) => D.regions.reduce((h, R) => h + regionH(R, phone) + REGION_GAP, 0);

/** How far down level 0 an era's band is, in px from the top of the first region. */
export function eraSpan(D: Prepared, id: string, phone: boolean): [number, number] | undefined {
  let top = 0;
  for (const R of D.regions) {
    const e = R.eras.find((x) => x.id === id);
    if (e) {
      const y = top + (phone ? HEAD_H : 0) + REGION_PAD + e.row * (BAND_H + BAND_GAP);
      return [y, y + BAND_H];
    }
    top += regionH(R, phone) + REGION_GAP;
  }
  return undefined;
}

/** The arrow keys at level 0: ←/→ the era before or after in its region, ↑/↓ the nearest in time in the region above or below. */
export function stepEra(D: Prepared, activeId: string | undefined, key: StepKey, win: YearWindow): string | undefined {
  const nearest = (list: PEra[], y: number) => list.reduce<PEra | undefined>((b, e) => (!b || Math.abs(e.s - y) < Math.abs(b.s - y) ? e : b), undefined);
  const ri = D.regions.findIndex((R) => R.eras.some((e) => e.id === activeId));
  if (ri < 0) return nearest(D.regions.flatMap((R) => R.eras), (win.start + win.end) / 2)?.id;
  const list = D.regions[ri].eras;
  const i = list.findIndex((e) => e.id === activeId);
  switch (key) {
    case 'ArrowLeft': return list[Math.max(0, i - 1)].id;
    case 'ArrowRight': return list[Math.min(list.length - 1, i + 1)].id;
    case 'Home': return list[0].id;
    case 'End': return list[list.length - 1].id;
    default: {
      const R = D.regions[ri + (key === 'ArrowUp' ? -1 : 1)];
      return R ? nearest(R.eras, list[i].s)!.id : activeId;
    }
  }
}

/** What a screen reader says for an era: "Classical Greece, 480–323 BCE, Greece, 38 highlights, 2 of 6". */
export function describeEra(D: Prepared, id: string): string {
  for (const R of D.regions) {
    const i = R.eras.findIndex((e) => e.id === id);
    if (i < 0) continue;
    const e = R.eras[i];
    return `${e.title}, ${e.when}, ${R.label}, ${e.highlights} ${e.highlights === 1 ? 'highlight' : 'highlights'}, ${i + 1} of ${R.eras.length}`;
  }
  return '';
}

/* ---------- binary search ---------- */

export function lowerBound(a: Float64Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
export function upperBound(a: Float64Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

/** The member that leads a cluster: the most prominent, the earliest on a tie. */
export function pickLead(members: PItem[], prominence: (id: string) => number): PItem {
  let best = members[0], bp = prominence(best.id);
  for (const m of members) { const p = prominence(m.id); if (p > bp) { best = m; bp = p; } }
  return best;
}

/* ---------- the arrow keys ---------- */

export type StepKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/**
 * Where the arrow keys go from `activeId`: ←/→ the previous or next entry in its lane, ↑/↓ the
 * entry nearest in time in the next lane up or down that has any, Home/End the lane's first or
 * last. With nothing active yet, any key starts at the entry nearest the middle of the window.
 */
export function stepActive(D: Prepared, activeId: string | undefined, key: StepKey, win: YearWindow): string | undefined {
  const cur = activeId ? D.byId.get(activeId) : undefined;
  return stepThrough(D.lanes.map((l) => l.order), cur && !cur.draft ? cur.lane : undefined, activeId, key, win);
}

/** The arrow keys through lanes of entries, each in time order; `li` is the active entry's lane. */
function stepThrough(lanes: PItem[][], li: number | undefined, activeId: string | undefined, key: StepKey, win: YearWindow): string | undefined {
  const nearest = (list: PItem[], y: number) => list.reduce<PItem | undefined>((b, it) => (!b || Math.abs(it.s - y) < Math.abs(b.s - y) ? it : b), undefined);
  const list = li === undefined ? undefined : lanes[li];
  const i = list ? list.findIndex((x) => x.id === activeId) : -1;
  if (!list || i < 0) return nearest(lanes.flat(), (win.start + win.end) / 2)?.id;
  switch (key) {
    case 'ArrowLeft': return list[Math.max(0, i - 1)].id;
    case 'ArrowRight': return list[Math.min(list.length - 1, i + 1)].id;
    case 'Home': return list[0].id;
    case 'End': return list[list.length - 1].id;
    default: {
      const dir = key === 'ArrowUp' ? -1 : 1;
      for (let j = li! + dir; j >= 0 && j < lanes.length; j += dir) {
        const hit = nearest(lanes[j], list[i].s);
        if (hit) return hit.id;
      }
      return activeId;
    }
  }
}

/** How far down the lanes an entry's row is, in px from the top of the first lane: a moment can be in any of its lane's moment rows. */
export function rowSpan(D: Prepared, it: PItem): [number, number] {
  if (it.war) return rowSpan(D, D.byId.get(it.war)!);
  const L = D.lanes[it.lane];
  const moments = PAD_TOP + L.momentRows * ROW_H;
  if (it.kind === 'event') return [L.top, L.top + moments];
  const top = L.top + moments + it.row * ROW_H;
  return [top, top + ROW_H];
}

/** What a screen reader says for an entry: "Plato, 428–348 BCE, Ideas, 3 of 12". */
export function describeEntry(D: Prepared, id: string): string {
  const it = D.byId.get(id);
  if (!it) return '';
  const L = D.lanes[it.lane];
  return `${it.title}, ${it.when}, ${L.label}, ${L.order.indexOf(it) + 1} of ${L.order.length}`;
}

/* ---------- the frame ---------- */

export interface View {
  win: YearWindow;
  scrollY: number;
  selected?: string;
  hover?: string;
  /** The map's year, drawn as a playhead. */
  playYear?: number;
  /** Today, as a decimal year. */
  now: number;
  /** When an entry is open and has connections: each lit entry's role; everyone else fades. */
  roles?: Map<string, string>;
  /** Arrows between entries, drawn when both ends are in view. */
  links?: Link[];
  /** The open entry's dates can be dragged. */
  editable?: boolean;
  /** The open entry while it's dragged: where it would go, and its new dates in words. */
  drag?: { id: string; s: number; e: number; label: string; y: number };
  /** The entry the arrow keys are on, and whether to ring it (only while the timeline has keyboard focus). */
  active?: string;
  ring?: boolean;
  /** Level 1: the open era's lanes. */
  era?: EraLanes;
  /** While an era opens or closes: how far open it is (0 to 1), whether it only fades (reduced motion), and level 0's scroll. */
  zoom?: { t: number; fade: boolean; scroll0: number };
}

export interface Env {
  w: number;
  h: number;
  /** Width of the lane names on the left. */
  gutter: number;
  measure: Measure;
}

interface Ctx { D: Prepared; V: View; E: Env; S: Scene; X: (y: number) => number; x0: number; x1: number; top: number; bottom: number }

/** How far the lanes (or, at level 0, the regions; at level 1, the open era's lanes) can scroll. */
export function maxScroll(D: Prepared, h: number, level: Level = 2, w = Infinity, era?: EraLanes): number {
  if (level === 1 && era) return Math.max(0, lanesH(era, w < PHONE_W) - (h - AXIS_H - HEAD1_H) + 8);
  const content = level === 0 ? erasH(D, w < PHONE_W) : D.contentH;
  return Math.max(0, content - (h - AXIS_H) + 8);
}

/** Text cut short with an ellipsis to fit `avail` px, or '' when even that won't fit. */
function fit(M: Measure, font: Parameters<Measure>[0], s: string, avail: number): string {
  if (M(font, s) <= avail) return s;
  const ell = M(font, '…');
  if (avail <= ell) return '';
  let n = s.length - 1;
  while (n > 0 && M(font, s.slice(0, n)) + ell > avail) n--;
  return n > 0 ? `${s.slice(0, n).trimEnd()}…` : '';
}

/** A label of `lw` px in `room` px: whole, cut short, or hidden below 48 px. */
function placeLabel(M: Measure, font: Parameters<Measure>[0], s: string, room: number): string {
  if (M(font, s) <= room) return s;
  return room >= MIN_LABEL ? fit(M, font, s, room) : '';
}

const badgeR = (n: number) => 9 + Math.max(0, String(n).length - 2) * 3;
/** A draft's name says it's waiting for Bob. */
const titleOf = (it: PItem) => (it.draft ? `${it.title} ?` : it.title);

/** The extra class an entry gets while an entry with connections is open: its role, or faded. */
function roleOf(V: View, it: PItem): string {
  if (!V.roles || it.draft) return '';
  return ` ${V.roles.get(it.id) ?? 'dimmed'}`;
}
/** The outline that lights up an influence: amber for who influenced, blue for whom. */
const ROLE_STROKE: Record<string, string> = { 'infl-by': 'var(--glow-by)', 'infl-on': 'var(--glow-on)', linked: 'var(--muted)' };

export function layout(D: Prepared, V: View, E: Env, level: Level = 2): Scene {
  const x0 = E.gutter, x1 = E.w;
  const S: Scene = {
    z: [[], [], [], []], gutter: [], axis: [], targets: [], clusters: [], boxes: new Map(),
    plot: { x: x0, y: AXIS_H, w: Math.max(0, x1 - x0), h: Math.max(0, E.h - AXIS_H) },
    gutterBox: { x: 0, y: AXIS_H, w: x0, h: Math.max(0, E.h - AXIS_H) },
    contentH: level === 0 ? erasH(D, E.w < PHONE_W) : level === 1 && V.era ? lanesH(V.era, E.w < PHONE_W) : D.contentH,
  };
  const span = V.win.end - V.win.start;
  const ppy = (x1 - x0) / span;
  const X = (y: number) => x0 + (y - V.win.start) * ppy;
  const c: Ctx = { D, V, E, S, X, x0, x1, top: AXIS_H, bottom: E.h };

  if (level === 0) {
    eraRows(c);
    arrows(c);
    focusRing(c);
    axis(c, level);
    return S;
  }
  if (level === 1 && V.era) {
    eraLevel(c, V.era);
    if (!V.zoom) arrows(c, false);
    focusRing(c);
    axis(c, level);
    return S;
  }
  for (const L of D.lanes) {
    const laneTop = AXIS_H + L.top - V.scrollY;
    const laneBot = laneTop + L.height;
    if (laneBot < AXIS_H || laneTop > E.h) continue;
    laneFrame(c, L, laneTop, laneBot);
    moments(c, L, laneTop + PAD_TOP);
    spans(c, L, laneTop + PAD_TOP + L.momentRows * ROW_H);
  }
  ties(c);
  arrows(c);
  focusRing(c);
  dragPreview(c);
  axis(c, level);
  return S;
}

/* ---------- level 0: a row per region, an era a band ---------- */

function eraRows(c: Ctx) {
  const { D, V, E, S, x0, x1 } = c;
  if (!D.regions.length) {
    const cx = (x0 + x1) / 2, cy = AXIS_H + Math.min(120, (E.h - AXIS_H) / 3);
    S.z[2].push({ t: 2, k: 'empty', a: 1, cls: 'tl-empty', x: cx, y: cy, s: 'No eras yet', f: 'era', fill: 'var(--ink-2)', anchor: 'middle' });
    S.z[2].push({ t: 2, k: 'empty2', a: 1, cls: 'tl-empty', x: cx, y: cy + 22, s: 'Periods you add show here, in a row for each region.', f: 'ui', fill: 'var(--muted)', anchor: 'middle' });
    return;
  }
  const phone = E.w < PHONE_W;
  let top = AXIS_H - V.scrollY;
  for (const R of D.regions) {
    const h = regionH(R, phone);
    if (top + h >= AXIS_H && top <= E.h) region(c, R, top, h, phone);
    top += h + REGION_GAP;
  }
}

function region(c: Ctx, R: PRegion, top: number, h: number, phone: boolean) {
  const { D, V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const bot = top + h;
  const count = `${R.highlights} ${R.highlights === 1 ? 'highlight' : 'highlights'}`;
  // A faint rule in the middle of the gap below, where threads will run.
  const ry = bot + REGION_GAP / 2 - 0.5;
  S.z[0].push({ t: 3, k: `rr${R.name}`, a: 1, x1: 0, y1: ry, x2: x1, y2: ry, stroke: 'var(--rule-soft)' });
  if (phone) {
    const name = fit(M, 'region', R.label, x1 - x0 - 24);
    S.z[2].push({ t: 2, k: `rn${R.name}`, a: 1, cls: 'tl-region', x: x0 + 12, y: top + 18, s: name, f: 'region', fill: 'var(--ink-2)' });
    const nx = x0 + 12 + M('region', name) + 10;
    if (nx + M('ui', count) < x1 - 8) S.z[2].push({ t: 2, k: `rc${R.name}`, a: 1, x: nx, y: top + 18, s: count, f: 'ui', fill: 'var(--muted)' });
  } else {
    S.gutter.push({ t: 3, k: `gr${R.name}`, a: 1, x1: 0, y1: ry, x2: E.gutter, y2: ry, stroke: 'var(--rule-soft)' });
    // The name stays in view while its row scrolls past.
    const ny = Math.min(Math.max(top + 26, AXIS_H + 26), bot - 22);
    S.gutter.push({ t: 2, k: `rn${R.name}`, a: 1, cls: 'tl-region', x: 14, y: ny, s: fit(M, 'region', R.label, E.gutter - 24), f: 'region', fill: 'var(--ink-2)' });
    S.gutter.push({ t: 2, k: `rc${R.name}`, a: 1, x: 14, y: ny + 17, s: count, f: 'ui', fill: 'var(--muted)' });
  }
  const bandsTop = top + (phone ? HEAD_H : 0) + REGION_PAD;
  for (const e of R.eras) {
    if (e.e < V.win.start || e.s > V.win.end) continue;
    const y = bandsTop + e.row * (BAND_H + BAND_GAP);
    if (y + BAND_H < AXIS_H || y > E.h) continue;
    const xa = X(e.s), xb = Math.max(X(e.e), xa + 3);
    const role = roleOf(V, D.byId.get(e.id)!);
    const { marks, text } = bandPrims(e, { xa, xb, x0, x1, y, hot: V.hover === e.id, selected: V.selected === e.id, role }, M);
    S.z[1].push(...marks);
    S.z[2].push(...text);
    const rx = Math.max(xa, x0 - 4), rw = Math.max(MIN_HIT, Math.min(xb, x1 + 4) - rx);
    S.boxes.set(e.id, { x: rx, y, w: rw, h: BAND_H });
    S.targets.push({ id: e.id, x: rx, y, w: rw, h: BAND_H });
    landmarks(c, e, xa, xb, y);
  }
}

/** An era's most prominent entries as their glyphs at their time, as many as fit without touching. */
function landmarks(c: Ctx, e: PEra, xa: number, xb: number, y: number) {
  const { D, V, S, X, x0, x1 } = c;
  const lo = Math.max(xa, x0) + 9, hi = Math.min(xb, x1) - 9;
  if (hi - lo < LANDMARK) return;
  const cy = y + LANDMARK_Y;
  const placed: number[] = [];
  for (const it of e.landmarks) {
    const x = X(it.kind === 'event' ? it.s : (Math.max(it.s, e.s) + Math.min(it.e, e.e)) / 2);
    if (x - LANDMARK / 2 < lo || x + LANDMARK / 2 > hi || placed.some((p) => Math.abs(p - x) < LANDMARK + 6)) continue;
    placed.push(x);
    const hot = V.hover === it.id;
    const role = roleOf(V, it);
    if (hot) S.z[2].push({ t: 1, k: `elh${e.id}:${it.id}`, a: 1, x, y: cy, r: LANDMARK / 2 + 3, fill: 'var(--panel)', stroke: 'var(--ink)', sw: 1.5 });
    S.z[2].push({ t: 6, k: `el${e.id}:${it.id}`, a: 1, cls: `tl-landmark${role}`, id: it.id, x: x - LANDMARK / 2, y: cy - LANDMARK / 2, w: LANDMARK, g: it.rep.kind, color: D.lanes[it.lane].color });
    if (!S.boxes.has(it.id)) S.boxes.set(it.id, { x: x - LANDMARK / 2, y: cy - LANDMARK / 2, w: LANDMARK, h: LANDMARK });
    S.targets.push({ id: it.id, x: x - MIN_HIT / 2, y: cy - MIN_HIT / 2, w: MIN_HIT, h: MIN_HIT });
  }
}

/* ---------- level 1: an era opened into six lanes ---------- */

/** The lane under the six for entries in no lane yet. */
export const NO_LANE = 'none';
/** Level 1's "All eras", in the header row. */
export const ERAS_BACK = '__eras';
/** The header row itself, so a tap on it lands on nothing under it. */
export const HEAD_ROW = '__head';
/** The row above the lanes with the era's name and dates (its theme chips join it in Phase 4). */
export const HEAD1_H = 38;
const PAD1 = 6;
const MOMENT_ROW = 26;
const DIAMOND = 12;
const LANE1_EMPTY = 52;
// On a phone each lane is its name, its bars without labels, then a dated list.
const P_HEAD = 30, P_MOMENT = 14, P_ROW = 12, P_ITEM = 30, P_YEAR = 92;

export interface Lane1 {
  id: Lane | typeof NO_LANE;
  label: string;
  color: string;
  /** Highlights in the era in this lane. */
  count: number;
  /** Spans of change (periods, lives) and key moments, each by start. */
  spans: PItem[];
  moments: PItem[];
  /** Every entry by start: the arrow keys' order, and the phone's list. */
  order: PItem[];
  rows: number;
}

export interface EraLanes {
  era: PEra;
  lanes: Lane1[];
  /** Each entry's lane, a span's row, and where the next span in its row starts. */
  laneOf: Map<string, number>;
  rowOf: Map<string, number>;
  nextOf: Map<string, number>;
}

/**
 * An era's six lanes, in pigment order, then "No lane yet" when anything has none. What's in
 * it is what level 0 counts (`eraRegions`): its members and its inner eras' members, plus the inner
 * eras themselves. `lanesOf` is each entry's lanes (`entryLanes`); for now an entry sits in its
 * first, until a polity's lanes (Phase 4 ticket 7) draw it in each.
 */
export function eraLanes(D: Prepared, eraId: string, lanesOf: ReadonlyMap<string, readonly Lane[]>): EraLanes | undefined {
  const R = D.regions.find((r) => r.eras.some((e) => e.id === eraId));
  if (!R) return undefined;
  const byEra = new Map(R.eras.map((e) => [e.id, e]));
  const era = byEra.get(eraId)!;
  const inside = (e: PEra) => {
    for (let p: PEra | undefined = e, n = 0; p && n < 50; p = p.parent ? byEra.get(p.parent) : undefined, n++) if (p.id === eraId) return true;
    return false;
  };
  const ids = new Set<string>();
  for (const e of R.eras) {
    if (!inside(e)) continue;
    if (e.id !== eraId) ids.add(e.id);
    for (const m of e.members) ids.add(m);
  }
  const items = [...ids].map((id) => D.byId.get(id)).filter((p): p is PItem => !!p && !p.draft)
    .sort((a, b) => a.s - b.s || b.e - a.e || a.id.localeCompare(b.id));
  const defs: Omit<Lane1, 'spans' | 'moments' | 'order' | 'rows'>[] = [
    ...LANES.map((d) => ({ id: d, label: LANE_LABEL[d], color: `var(--pig-${PIGMENT[d]})`, count: era.mix[d] })),
    { id: NO_LANE, label: 'No lane yet', color: UMBER, count: era.noLane },
  ];
  const laneOf = new Map<string, number>(), rowOf = new Map<string, number>(), nextOf = new Map<string, number>();
  const lanes = defs.map((l, li): Lane1 => {
    const mine = items.filter((it) => (lanesOf.get(it.id)?.[0] ?? NO_LANE) === l.id);
    for (const it of mine) laneOf.set(it.id, li);
    const spans = mine.filter((it) => it.kind !== 'event');
    // Packed into rows by time only, so rows stay put while zooming.
    const rowEnd: number[] = [], rowLast: PItem[] = [];
    for (const it of spans) {
      let r = rowEnd.findIndex((end) => end <= it.s);
      if (r < 0) r = rowEnd.length;
      if (rowLast[r]) nextOf.set(rowLast[r].id, it.s);
      rowEnd[r] = it.e;
      rowLast[r] = it;
      rowOf.set(it.id, r);
    }
    return { ...l, spans, moments: mine.filter((it) => it.kind === 'event'), order: mine, rows: rowEnd.length };
  });
  // "No lane yet" is last, so leaving it out moves no other lane.
  return { era, lanes: lanes.filter((l) => l.id !== NO_LANE || l.order.length), laneOf, rowOf, nextOf };
}

function laneH(L: Lane1, phone: boolean): number {
  if (phone) return L.order.length ? P_HEAD + (L.moments.length ? P_MOMENT : 0) + L.rows * P_ROW + 6 + L.order.length * P_ITEM + 10 : P_HEAD + 34;
  if (!L.order.length) return LANE1_EMPTY;
  return Math.max(LANE_MIN, PAD1 + (L.moments.length ? MOMENT_ROW : 0) + L.rows * ROW_H + PAD_BOTTOM);
}
const lanesH = (EL: EraLanes, phone: boolean) => EL.lanes.reduce((h, L) => h + laneH(L, phone), 0);

/** How far down the lanes (under the header row) an entry's row is, in px: on a phone, its line in the list. */
export function lane1Span(EL: EraLanes, id: string, phone: boolean): [number, number] | undefined {
  const li = EL.laneOf.get(id);
  if (li === undefined) return undefined;
  let top = 0;
  for (let i = 0; i < li; i++) top += laneH(EL.lanes[i], phone);
  const L = EL.lanes[li];
  if (phone) {
    const y = top + P_HEAD + (L.moments.length ? P_MOMENT : 0) + L.rows * P_ROW + 6 + L.order.findIndex((x) => x.id === id) * P_ITEM;
    return [y, y + P_ITEM];
  }
  const rows = top + PAD1 + (L.moments.length ? MOMENT_ROW : 0);
  const row = EL.rowOf.get(id);
  return row === undefined ? [top + PAD1, top + PAD1 + MOMENT_ROW] : [rows + row * ROW_H, rows + (row + 1) * ROW_H];
}

/** The arrow keys at level 1: ←/→ through a lane in time order, ↑/↓ the nearest in time in the next lane with anything. */
export function stepLane1(EL: EraLanes, activeId: string | undefined, key: StepKey, win: YearWindow): string | undefined {
  return stepThrough(EL.lanes.map((l) => l.order), activeId ? EL.laneOf.get(activeId) : undefined, activeId, key, win);
}

/** What a screen reader says for an entry at level 1: "Athenian silver “owls”, c. 510 BCE – 322 BCE, Economic, 1 of 4". */
export function describeLane1(EL: EraLanes, id: string): string {
  const li = EL.laneOf.get(id);
  if (li === undefined) return '';
  const L = EL.lanes[li];
  const i = L.order.findIndex((x) => x.id === id);
  return `${L.order[i].title}, ${L.order[i].when}, ${L.label}, ${i + 1} of ${L.order.length}`;
}

const highlightsN = (n: number) => `${n} ${n === 1 ? 'highlight' : 'highlights'}`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const blank = (S: Scene): Scene => ({ ...S, z: [[], [], [], []], gutter: [], axis: [], targets: [], clusters: [], boxes: new Map() });

/** A primitive moved by `Y` and faded: marks by `ma`, words and glyphs by `ta`. Arrows and shapes wait until it's open. */
function squash(p: Prim, Y: (y: number) => number, ma: number, ta: number): Prim | undefined {
  switch (p.t) {
    case 0: case 4: { const y = Y(p.y); return { ...p, y, h: Math.max(0, Y(p.y + p.h) - y), a: p.a * ma }; }
    case 1: return { ...p, y: Y(p.y), a: p.a * ma };
    case 2: return { ...p, y: Y(p.y), a: p.a * ta };
    case 3: return { ...p, y1: Y(p.y1), y2: Y(p.y2), a: p.a * ma };
    case 6: return { ...p, y: Y(p.y + p.w / 2) - p.w / 2, a: p.a * ta };
    default: return undefined;
  }
}

function eraLevel(c: Ctx, EL: EraLanes) {
  const { D, V, E, S } = c;
  const phone = E.w < PHONE_W;
  const z = V.zoom;
  if (!z || z.t >= 1) { lanes1(c, EL, phone); return; }
  // Opening or closing: the other rows fade while the lanes grow out of the era's band, on the
  // same time scale. With reduced motion the lanes only fade in where they'll be.
  const t = z.t;
  const c0: Ctx = { ...c, V: { ...V, scrollY: z.scroll0, hover: undefined, selected: undefined }, S: blank(S) };
  eraRows(c0);
  for (let i = 0; i < 4; i++) for (const p of c0.S.z[i]) S.z[i].push({ ...p, a: p.a * (1 - t) });
  for (const p of c0.S.gutter) S.gutter.push({ ...p, a: p.a * (1 - t) });
  const c1: Ctx = { ...c, S: blank(S) };
  lanes1(c1, EL, phone);
  const band = eraSpan(D, EL.era.id, phone);
  const by = band ? AXIS_H + band[0] - z.scroll0 : AXIS_H;
  const visH = Math.max(1, Math.min(HEAD1_H + lanesH(EL, phone) - V.scrollY, E.h - AXIS_H));
  const Y = z.fade ? (y: number) => y : (y: number) => { const shut = by + clamp01((y - AXIS_H) / visH) * BAND_H; return shut + (y - shut) * t; };
  const ma = z.fade ? t : Math.min(1, t * 1.6), ta = z.fade ? t : clamp01((t - 0.45) / 0.55);
  for (let i = 0; i < 4; i++) for (const p of c1.S.z[i]) { const q = squash(p, Y, ma, ta); if (q) S.z[i].push(q); }
  for (const p of c1.S.gutter) { const q = squash(p, Y, ma, ta); if (q) S.gutter.push(q); }
  // Taps wait until it's open: nothing is a target in between.
}

function lanes1(c: Ctx, EL: EraLanes, phone: boolean) {
  const { V, E } = c;
  const lanesTop = AXIS_H + HEAD1_H;
  const cl: Ctx = { ...c, top: lanesTop };
  let top = lanesTop - V.scrollY;
  for (const L of EL.lanes) {
    const h = laneH(L, phone);
    if (top + h >= lanesTop && top <= E.h) (phone ? phoneLane : lane1)(cl, EL, L, top, h);
    top += h;
  }
  head1(c, EL, phone);
}

/** What an empty lane says, in Bob's words. */
const EMPTY_NOTE: Record<Lane1['id'], string> = {
  politics: 'No politics or law here yet.', war: 'No wars here yet.', economy: 'Nothing on the economy here yet.',
  ideas: 'No philosophy or religion here yet.', technology: 'No technology here yet.', nature: 'Nothing on nature here yet.', none: '',
};
const emptyNote = (L: Lane1) => EMPTY_NOTE[L.id];

function lane1(c: Ctx, EL: EraLanes, L: Lane1, top: number, h: number) {
  const { E, S, X, x0, x1 } = c;
  const M = E.measure;
  const bot = top + h;
  // A faint wash of the lane's pigment over the era's years.
  const wa = Math.max(X(EL.era.s), x0 - 2), wb = Math.min(X(EL.era.e), x1 + 2);
  if (wb > wa) S.z[0].push({ t: 0, k: `qw${L.id}`, a: 1, cls: `tl-lane1 ${L.id}`, x: wa, y: top, w: wb - wa, h, fill: tint(L.color, 7) });
  S.z[0].push({ t: 3, k: `qr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: x1, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  S.gutter.push({ t: 3, k: `qgr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: E.gutter, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  // Its name stays in view while the lane scrolls past.
  const ny = Math.min(Math.max(top + 9, c.top + 9), bot - 36);
  S.gutter.push({ t: 0, k: `qgs${L.id}`, a: 1, x: 14, y: ny + 2, w: 9, h: 9, r: 1, fill: L.color });
  S.gutter.push({ t: 2, k: `qgn${L.id}`, a: 1, cls: 'tl-lane-name', x: 30, y: ny + 11, s: fit(M, 'dim', L.label.toUpperCase(), E.gutter - 38), f: 'dim', fill: 'var(--ink)' });
  if (L.count) S.gutter.push({ t: 2, k: `qgc${L.id}`, a: 1, x: 30, y: ny + 27, s: highlightsN(L.count), f: 'dimCount', fill: 'var(--muted)' });
  if (!L.order.length) {
    S.z[2].push({ t: 2, k: `qe${L.id}`, a: 1, cls: 'tl-lane-empty', x: Math.max(x0, wa) + 16, y: top + h / 2 + 5, s: emptyNote(L), f: 'note', fill: 'var(--muted)' });
    return;
  }
  let rowsTop = top + PAD1;
  if (L.moments.length) { moments1(c, L, rowsTop); rowsTop += MOMENT_ROW; }
  for (const it of L.spans) phase(c, EL, L, it, rowsTop + EL.rowOf.get(it.id)! * ROW_H);
}

/** Key moments: diamonds on a row above the spans, each named unless its name would run into the one before. */
function moments1(c: Ctx, L: Lane1, rowTop: number) {
  const { V, E, S, X, x0, x1 } = c;
  if (rowTop + MOMENT_ROW < c.top || rowTop > c.bottom) return;
  const M = E.measure;
  const cy = rowTop + MOMENT_ROW / 2;
  const xs = L.moments.map((m) => X(m.s));
  let right = -Infinity;
  L.moments.forEach((it, i) => {
    const x = xs[i];
    if (x < x0 - 240 || x > x1 + DIAMOND) return;
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    const lit = ROLE_STROKE[role.trim()];
    const w = sel ? DIAMOND + 4 : DIAMOND;
    if (hot || lit) S.z[1].push({ t: 1, k: `qmh${it.id}`, a: 1, cls: role.trim() || undefined, x, y: cy, r: w / 2 + 3, fill: 'var(--panel)', stroke: lit ?? 'var(--ink)', sw: lit ? 2.5 : 1.5 });
    S.z[1].push({ t: 6, k: `qm${it.id}`, a: 1, cls: `tl-mark tl-moment${sel ? ' selected' : ''}${role}`, id: it.id, x: x - w / 2, y: cy - w / 2, w, g: it.approx ? 'diamond-approx' : 'diamond', color: L.color });
    S.boxes.set(it.id, { x: x - w / 2, y: cy - w / 2, w, h: w });
    const hx = x - MIN_HIT / 2;
    let hw = MIN_HIT;
    if (x - DIAMOND / 2 - 4 > right) {
      const next = i + 1 < xs.length ? xs[i + 1] - DIAMOND : Infinity;
      const lx = x + DIAMOND / 2 + 5;
      const label = placeLabel(M, 'ui', it.title, Math.min(next, x1 - 4) - lx);
      if (label) {
        S.z[2].push({ t: 2, k: `qmt${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: lx, y: cy + 4, s: label, f: 'ui', fill: hot ? 'var(--ink)' : 'var(--ink-2)' });
        right = lx + M('ui', label);
        hw = right + 4 - hx;
      } else right = x + DIAMOND / 2;
    }
    S.targets.push({ id: it.id, lane: L.id, x: hx, y: rowTop, w: hw, h: MOMENT_ROW });
  });
}

/** A span of change: a named bar in its row, dashed when a date is approximate. */
function phase(c: Ctx, EL: EraLanes, L: Lane1, it: PItem, rowTop: number) {
  const { V, E, S, X, x0, x1 } = c;
  if (it.e < V.win.start || it.s > V.win.end || rowTop + ROW_H < c.top || rowTop > c.bottom) return;
  const M = E.measure;
  const xa = X(it.s), xb = Math.max(X(it.e), xa + 3);
  const rx = Math.max(xa, x0 - 4), rw = Math.max(3, Math.min(xb, x1 + 4) - rx);
  const va = Math.max(xa, x0), vw = Math.min(xb, x1) - va;
  const by = rowTop + 4, bh = 20;
  const sel = V.selected === it.id, hot = sel || V.hover === it.id;
  const role = roleOf(V, it);
  const lit = ROLE_STROKE[role.trim()];
  S.z[1].push({
    t: 0, k: `qb${it.id}`, a: 1, cls: `tl-mark tl-phase${sel ? ' selected' : ''}${role}`, id: it.id, x: rx, y: by, w: rw, h: bh, r: 2, fill: tint(L.color, hot ? 28 : 16),
    stroke: lit ?? (sel ? 'var(--ink)' : `color-mix(in srgb, ${L.color} 60%, transparent)`), sw: lit ? 2.5 : sel ? 2 : 1, dash: !lit && !sel && (it.approx || it.endApprox),
  });
  S.boxes.set(it.id, { x: rx, y: by, w: rw, h: bh });
  let hx = rx, hw = rw;
  if (hw < MIN_HIT) { hx = rx + rw / 2 - MIN_HIT / 2; hw = MIN_HIT; }
  // Its name: inside, else just after it when there's room before the next in its row, else cut short, else hidden.
  const lw = M('span', it.title);
  const ty = by + bh / 2 + 4.5;
  if (vw >= 3 && lw + 14 <= vw) {
    S.z[2].push({ t: 2, k: `qbt${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: va + 7, y: ty, s: it.title, f: 'span', fill: 'var(--ink)' });
  } else if (vw >= 3) {
    const next = EL.nextOf.get(it.id);
    const room = (next === undefined ? Infinity : X(next)) - xb - 12;
    if (lw <= room && xb + 6 + lw <= x1) {
      S.z[2].push({ t: 2, k: `qbt${it.id}`, a: 1, cls: `tl-label${role} out`, id: it.id, x: xb + 6, y: ty, s: it.title, f: 'span', fill: 'var(--ink-2)' });
      hw = Math.max(hw, xb + 6 + lw - hx);
    } else {
      const s = vw >= MIN_LABEL ? fit(M, 'span', it.title, vw - 14) : '';
      if (s) S.z[2].push({ t: 2, k: `qbt${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: va + 7, y: ty, s, f: 'span', fill: 'var(--ink)' });
    }
  }
  S.targets.push({ id: it.id, lane: L.id, x: hx, y: rowTop, w: hw, h: ROW_H });
}

/** On a phone: the lane's name, its bars without labels, then a dated list of its spans and moments to tap. */
function phoneLane(c: Ctx, EL: EraLanes, L: Lane1, top: number, h: number) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  S.z[0].push({ t: 0, k: `qw${L.id}`, a: 1, cls: `tl-lane1 ${L.id}`, x: x0, y: top, w: x1 - x0, h, fill: tint(L.color, 6) });
  S.z[0].push({ t: 3, k: `qr${L.id}`, a: 1, x1: x0, y1: top + h - 0.5, x2: x1, y2: top + h - 0.5, stroke: 'var(--rule-soft)' });
  S.z[2].push({ t: 0, k: `qgs${L.id}`, a: 1, x: x0 + 12, y: top + 12, w: 9, h: 9, r: 1, fill: L.color });
  const name = L.label.toUpperCase();
  S.z[2].push({ t: 2, k: `qgn${L.id}`, a: 1, cls: 'tl-lane-name', x: x0 + 28, y: top + 21, s: name, f: 'dim', fill: 'var(--ink)' });
  if (L.count) S.z[2].push({ t: 2, k: `qgc${L.id}`, a: 1, x: x0 + 28 + M('dim', name) + 10, y: top + 21, s: highlightsN(L.count), f: 'dimCount', fill: 'var(--muted)' });
  if (!L.order.length) {
    S.z[2].push({ t: 2, k: `qe${L.id}`, a: 1, cls: 'tl-lane-empty', x: x0 + 12, y: top + P_HEAD + 18, s: emptyNote(L), f: 'note', fill: 'var(--muted)' });
    return;
  }
  let y = top + P_HEAD;
  if (L.moments.length) {
    for (const m of L.moments) {
      const x = X(m.s);
      if (x < x0 - 6 || x > x1 + 6) continue;
      S.z[1].push({ t: 6, k: `qm${m.id}`, a: 1, cls: `tl-moment${roleOf(V, m)}`, id: m.id, x: x - 4.5, y: y + P_MOMENT / 2 - 4.5, w: 9, g: m.approx ? 'diamond-approx' : 'diamond', color: L.color });
    }
    y += P_MOMENT;
  }
  for (const it of L.spans) {
    const xa = X(it.s), xb = Math.max(X(it.e), xa + 3);
    if (xb < x0 || xa > x1) continue;
    const rx = Math.max(xa, x0 - 2);
    S.z[1].push({ t: 0, k: `qb${it.id}`, a: 1, cls: `tl-phase${roleOf(V, it)}`, id: it.id, x: rx, y: y + EL.rowOf.get(it.id)! * P_ROW + 2, w: Math.min(xb, x1 + 2) - rx, h: P_ROW - 4, r: 1.5, fill: tint(L.color, 30), stroke: it.approx || it.endApprox ? L.color : undefined, dash: it.approx || it.endApprox });
  }
  y += L.rows * P_ROW + 6;
  L.order.forEach((it, i) => {
    const ry = y + i * P_ITEM;
    if (ry + P_ITEM < c.top || ry > c.bottom) return;
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    if (hot) S.z[1].push({ t: 0, k: `qlb${it.id}`, a: 1, x: x0 + 4, y: ry + 1, w: x1 - x0 - 8, h: P_ITEM - 2, r: 4, fill: tint(L.color, sel ? 24 : 12) });
    const years = fit(M, 'tick', it.dates, P_YEAR - 8);
    S.z[2].push({ t: 2, k: `qly${it.id}`, a: 1, cls: role.trim() || undefined, x: x0 + 12, y: ry + 19, s: years, f: 'tick', fill: 'var(--muted)' });
    // An approximate date is underlined with a dashed umber rule, as edges are dashed elsewhere.
    if (it.approx || it.endApprox) S.z[2].push({ t: 3, k: `qlu${it.id}`, a: 1, cls: 'tl-approx', x1: x0 + 12, y1: ry + 23, x2: x0 + 12 + M('tick', years), y2: ry + 23, stroke: UMBER, dash: true });
    let tx = x0 + 12 + P_YEAR;
    if (it.kind === 'event') {
      S.z[2].push({ t: 6, k: `qld${it.id}`, a: 1, cls: role.trim() || undefined, x: tx, y: ry + P_ITEM / 2 - 4.5, w: 9, g: it.approx ? 'diamond-approx' : 'diamond', color: L.color });
      tx += 15;
    }
    S.z[2].push({ t: 2, k: `qlt${it.id}`, a: 1, cls: `tl-list-item${sel ? ' selected' : ''}${role}`, id: it.id, x: tx, y: ry + 19.5, s: fit(M, 'item', it.title, x1 - 12 - tx), f: 'item', fill: 'var(--ink)' });
    S.boxes.set(it.id, { x: x0 + 4, y: ry + 1, w: x1 - x0 - 8, h: P_ITEM - 2 });
    S.targets.push({ id: it.id, lane: L.id, x: x0, y: ry, w: x1 - x0, h: P_ITEM });
  });
}

/** The row above the lanes: "‹ All eras", then the era's name (which opens it), dates and highlights. */
function head1(c: Ctx, EL: EraLanes, phone: boolean) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const era = EL.era, y = AXIS_H, h = HEAD1_H, ty = y + 24;
  const back = '‹ All eras';
  S.targets.push({ id: HEAD_ROW, x: x0, y, w: x1 - x0, h });
  S.z[3].push({ t: 0, k: 'qhbg', a: 1, x: x0, y, w: x1 - x0, h, fill: 'var(--panel)' });
  S.z[3].push({ t: 3, k: 'qhr', a: 1, x1: x0, y1: y + h - 0.5, x2: x1, y2: y + h - 0.5, stroke: 'var(--rule)' });
  const hotBack = V.hover === ERAS_BACK;
  let nx: number;
  if (phone) {
    S.z[3].push({ t: 2, k: 'qback', a: 1, cls: 'tl-back', x: x0 + 12, y: ty, s: back, f: 'ui', fill: hotBack ? 'var(--ink)' : 'var(--ink-2)' });
    S.targets.push({ id: ERAS_BACK, x: x0, y, w: M('ui', back) + 24, h });
    nx = x0 + 12 + M('ui', back) + 16;
  } else {
    S.gutter.push({ t: 0, k: 'qgbg', a: 1, x: 0, y, w: E.gutter, h, fill: 'var(--panel)' });
    S.gutter.push({ t: 3, k: 'qghr', a: 1, x1: 0, y1: y + h - 0.5, x2: E.gutter, y2: y + h - 0.5, stroke: 'var(--rule)' });
    S.gutter.push({ t: 2, k: 'qback', a: 1, cls: 'tl-back', x: 14, y: ty, s: back, f: 'ui', fill: hotBack ? 'var(--ink)' : 'var(--ink-2)' });
    S.targets.push({ id: ERAS_BACK, gutter: true, x: 0, y, w: Math.min(E.gutter, M('ui', back) + 28), h });
    // The name sits at the era's start, and stays in view while that scrolls off to the left.
    nx = Math.max(X(era.s), x0) + 12;
  }
  const name = fit(M, 'era', era.title, x1 - nx - 12);
  if (!name) return;
  const nw = M('era', name);
  const sel = V.selected === era.id, hot = sel || V.hover === era.id;
  S.z[3].push({ t: 2, k: 'qhn', a: 1, cls: `tl-era-head${sel ? ' selected' : ''}`, id: era.id, x: nx, y: ty, s: name, f: 'era', fill: 'var(--ink)' });
  if (hot) S.z[3].push({ t: 3, k: 'qhu', a: 1, x1: nx, y1: ty + 4, x2: nx + nw, y2: ty + 4, stroke: sel ? 'var(--ink)' : 'var(--ink-2)', sw: sel ? 1.5 : 1 });
  S.targets.push({ id: era.id, x: nx - 4, y, w: nw + 8, h });
  const rest = `${era.when} · ${highlightsN(era.highlights)}`;
  if (nx + nw + 12 + M('eraDates', rest) <= x1 - 8) S.z[3].push({ t: 2, k: 'qhd', a: 1, x: nx + nw + 12, y: ty, s: rest, f: 'eraDates', fill: 'var(--muted)' });
}

function laneFrame(c: Ctx, L: PLane, top: number, bot: number) {
  const { S, E, x1 } = c;
  S.z[0].push({ t: 3, k: `lr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: x1, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  S.gutter.push({ t: 3, k: `gr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: E.gutter, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  // The name stays in view while its lane scrolls past.
  const ny = Math.min(Math.max(top + 9, AXIS_H + 9), bot - 31);
  S.gutter.push({ t: 0, k: `gs${L.id}`, a: 1, x: 12, y: ny, w: 10, h: 22, r: 2, fill: L.color });
  const name = fit(E.measure, 'lane', L.label, E.gutter - 30 - 8);
  S.gutter.push({ t: 2, k: `gn${L.id}`, a: 1, x: 30, y: ny + 15.5, s: name, f: 'lane', fill: 'var(--ink)' });
}

/* ---------- moments: dots in up to three rows; dots that would overlap become clusters ---------- */

interface Mark { members: PItem[]; x: number; last: number; r: number; lead: PItem; lw: number; row: number; room: number; before: number }

function moments(c: Ctx, L: PLane, rowsTop: number) {
  const { D, V, E, S, X, x0, x1 } = c;
  if (!L.events.length) return;
  const M = E.measure;
  const ppy = (x1 - x0) / (V.win.end - V.win.start);
  // Moments a little left of the window still draw: their labels reach into view.
  const lo = lowerBound(L.ES, V.win.start - 320 / ppy), hi = upperBound(L.ES, V.win.end + 16 / ppy);
  const marks: Mark[] = [];
  let cur: Mark | null = null;
  for (let i = lo; i < hi; i++) {
    const it = L.events[i];
    const x = X(it.s);
    // Drafts and the open entry never hide in a cluster.
    const alone = (p: PItem) => p.draft || p.id === V.selected;
    if (cur && x - cur.x < CLUSTER_PX && !alone(it) && !alone(cur.members[0])) { cur.members.push(it); cur.last = x; continue; }
    cur = { members: [it], x, last: x, r: it.rep.point === 'glyph' ? GLYPH / 2 : 5, lead: it, lw: 0, row: 0, room: Infinity, before: -Infinity };
    marks.push(cur);
  }
  // Each mark takes the first row its dot and label fit in; failing that, the row that frees up
  // soonest, and the label before it there is cut short.
  const rightOf = new Array<number>(L.momentRows).fill(-Infinity);
  const lastIn = new Array<Mark | null>(L.momentRows).fill(null);
  for (const m of marks) {
    if (m.members.length > 1) { m.lead = pickLead(m.members, D.prominence); m.r = badgeR(m.members.length); }
    m.lw = M('ui', titleOf(m.lead));
    const left = m.x - m.r - 4;
    let r = rightOf.findIndex((v) => v <= left);
    if (r < 0) {
      r = rightOf.indexOf(Math.min(...rightOf));
      const p = lastIn[r]!;
      p.room = Math.min(p.room, left - (p.x + p.r + 6) - 6);
    }
    m.row = r;
    m.before = rightOf[r];
    rightOf[r] = m.x + m.r + 6 + m.lw + 8;
    lastIn[r] = m;
  }
  for (const m of marks) {
    const rowTop = rowsTop + m.row * ROW_H;
    if (rowTop + ROW_H < c.top || rowTop > c.bottom) continue;
    const y = rowTop + ROW_H / 2;
    const it = m.lead;
    // At the right edge a label that won't fit flips to the left of its dot, when nothing is there.
    const edge = x1 - (m.x + m.r + 6) - 4;
    const flip = m.lw > edge && m.lw <= m.room && m.x - m.r - 6 - m.lw > Math.max(x0, m.before + 6);
    const label = placeLabel(M, 'ui', titleOf(it), flip ? m.lw : Math.min(m.room, edge));
    const lw = label ? M('ui', label) : 0;
    const lx = flip ? m.x - m.r - 6 : m.x + m.r + 6;
    const anchor = flip ? 'end' as const : undefined;
    const hx = flip ? lx - lw - 4 : m.x - 12;
    const hitW = label ? (flip ? m.x + 12 - hx : lx + lw + 4 - hx) : 24;
    const box = { x: m.x - m.r, y: y - m.r, w: m.r * 2, h: m.r * 2 };
    if (m.members.length > 1) {
      const cl: Cluster = { kind: 'event', count: m.members.length, members: m.members.map((x) => x.id), lead: it.id, lane: L.id, s: m.members[0].s, e: m.members[m.members.length - 1].s };
      S.clusters.push(cl);
      for (const id of cl.members) S.boxes.set(id, box);
      const hot = V.hover === `cluster:${it.id}`;
      const dim = V.roles && !m.members.some((x) => V.roles!.has(x.id)) ? ' dimmed' : '';
      S.z[1].push({ t: 1, k: `mc${it.id}`, a: 1, cls: `tl-cluster${dim}`, x: m.x, y, r: m.r, fill: L.color, stroke: hot ? 'var(--ink)' : 'var(--panel)', sw: hot ? 2 : 1.5 });
      S.z[2].push({ t: 2, k: `mn${it.id}`, a: 1, cls: dim.trim() || undefined, x: m.x, y: y + 4, s: String(cl.count), f: 'count', fill: 'var(--panel)', anchor: 'middle' });
      if (label) S.z[2].push({ t: 2, k: `mt${it.id}`, a: 1, cls: `tl-label${dim}`, x: lx, y: y + 4, s: label, f: 'ui', fill: 'var(--ink-2)', anchor });
      S.targets.push({ id: 'cluster', cluster: cl, lane: L.id, x: hx, y: rowTop, w: hitW, h: ROW_H });
      continue;
    }
    S.boxes.set(it.id, box);
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    const lit = ROLE_STROKE[role.trim()];
    const color = it.draft ? UMBER : L.color;
    const cls = `${it.draft ? 'tl-draft' : 'tl-mark'}${sel ? ' selected' : ''}${role}`;
    if (it.rep.point === 'glyph') {
      // The kind's glyph on a disc of the panel's colour; the disc's edge says open, hovered or approximate.
      const ring = lit ?? (hot ? 'var(--ink)' : it.approx || it.draft ? color : undefined);
      S.z[1].push({ t: 1, k: `m${it.id}`, a: 1, cls, id: it.id, x: m.x, y, r: GLYPH / 2 + 2, fill: 'var(--panel)', stroke: ring, sw: lit ? 2.5 : sel ? 2 : 1.25, dash: !lit && !hot && (it.approx || it.draft) });
      const g = sel ? GLYPH + 2 : GLYPH - 2;
      S.z[1].push({ t: 6, k: `mg${it.id}`, a: 1, cls: `tl-glyph${role}`, id: it.id, x: m.x - g / 2, y: y - g / 2, w: g, g: it.rep.kind, color });
    } else {
      S.z[1].push({
        t: 1, k: `m${it.id}`, a: 1, cls, id: it.id, x: m.x, y, r: sel ? 6 : 5,
        fill: it.approx || it.draft ? 'var(--panel)' : color, stroke: lit ?? (hot ? 'var(--ink)' : color), sw: lit ? 2.5 : sel ? 2 : 1.25, dash: it.approx || it.draft,
      });
    }
    if (label) S.z[2].push({ t: 2, k: `mt${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: lx, y: y + 4, s: label, f: it.draft ? 'spanI' : 'ui', fill: it.draft ? UMBER : 'var(--ink)', anchor });
    const target: Target = { id: it.id, lane: L.id, x: hx, y: rowTop, w: hitW, h: ROW_H };
    if (sel && V.editable) target.grip = 'body';
    S.targets.push(target);
  }
}

/* ---------- spans and lives: bars in their rows; slivers that would overlap become clusters ---------- */

interface Sliver { kind: MarkKind; members: PItem[]; left: number; right: number }

function spans(c: Ctx, L: PLane, rowsTop: number) {
  const { V } = c;
  if (!L.spans.length) return;
  const hi = upperBound(L.S, V.win.end), lo = lowerBound(L.PM, V.win.start);
  const pending = new Array<Sliver | null>(L.spanRows).fill(null);
  const flush = (row: number) => {
    const g = pending[row];
    pending[row] = null;
    if (!g) return;
    if (g.members.length === 1) bar(c, L, g.members[0], g.left, Math.max(g.right, g.left + 3), rowsTop);
    else sliverCluster(c, L, g, rowsTop);
  };
  for (let i = lo; i < hi; i++) {
    const it = L.spans[i];
    if (it.e < V.win.start) continue;
    const rowTop = rowsTop + it.row * ROW_H;
    if (rowTop + ROW_H < c.top || rowTop > c.bottom) continue;
    const xa = c.X(it.s), xb = c.X(it.e);
    if (xb - xa < TINY_PX && !it.draft && it.id !== V.selected) {
      const g = pending[it.row];
      if (g && g.kind === it.kind && xa - g.right < TINY_PX) { g.members.push(it); g.right = Math.max(g.right, xb); continue; }
      flush(it.row);
      pending[it.row] = { kind: it.kind, members: [it], left: xa, right: xb };
      continue;
    }
    flush(it.row);
    bar(c, L, it, xa, Math.max(xb, xa + 3), rowsTop);
  }
  for (let r = 0; r < pending.length; r++) flush(r);
}

function bar(c: Ctx, L: PLane, it: PItem, xa: number, xb: number, rowsTop: number) {
  const { V, E, S, x0, x1 } = c;
  const M = E.measure;
  const rowTop = rowsTop + it.row * ROW_H;
  const look = it.rep.bar;
  const person = it.kind === 'person';
  // Threads and ground lines are thin, with their name above; the rest are bars with it inside.
  const thin = look === 'thread' || look === 'ground';
  const bh = person ? 20 : 22;
  const by = rowTop + (ROW_H - bh) / 2;
  const ly = rowTop + 21.5;
  const rx = Math.max(xa, x0 - 4), rr = Math.min(xb, x1 + 4), rw = Math.max(3, rr - rx);
  const va = Math.max(xa, x0), vb = Math.min(xb, x1), vw = vb - va;
  const sel = V.selected === it.id, hot = sel || V.hover === it.id;
  const role = roleOf(V, it);
  const lit = ROLE_STROKE[role.trim()];
  const cls = `${it.draft ? 'tl-draft' : 'tl-mark'}${sel ? ' selected' : ''}${role}`;
  const rcls = role.trim() || undefined;
  const color = it.draft ? UMBER : L.color;
  S.boxes.set(it.id, thin ? { x: rx, y: rowTop + 4, w: rw, h: ROW_H - 6 } : { x: rx, y: by, w: rw, h: bh });
  if (it.draft && !thin) {
    S.z[1].push({ t: 0, k: `b${it.id}`, a: 1, cls, id: it.id, x: rx, y: by, w: rw, h: bh, r: person ? bh / 2 : 2, fill: tint(UMBER, 10), stroke: UMBER, sw: 1.5, dash: true });
  } else if (person) {
    S.z[1].push({ t: 0, k: `b${it.id}`, a: 1, cls, id: it.id, x: rx, y: by, w: rw, h: bh, r: bh / 2, fill: hot ? tint(L.color, 12) : 'var(--panel)', stroke: lit ?? (hot ? 'var(--ink)' : tint(L.color, 60)), sw: lit ? 2.5 : sel ? 2 : 1, dash: it.approx || it.endApprox });
  } else if (thin) {
    // A thread (an idea) or a ground line (a place): a line along the bottom of the row, dashed
    // where a date is approximate, under a hit area as tall as the row.
    const sw = look === 'ground' ? 5 : hot ? 3.5 : 2.5;
    const stroke = lit ?? (look === 'ground' ? tint(color, sel ? 90 : hot ? 70 : 45) : hot && !it.draft ? 'var(--ink)' : color);
    S.z[1].push({ t: 0, k: `b${it.id}`, a: 1, cls, id: it.id, x: rx, y: rowTop + 4, w: rw, h: ROW_H - 6, fill: 'transparent' });
    const cut = Math.min(24, (xb - xa) / 3);
    const pieces: [number, number, boolean][] = [];
    const a0 = it.approx ? xa + cut : xa, b0 = it.endApprox ? xb - cut : xb;
    if (it.approx || it.draft) pieces.push([xa, it.draft ? xb : a0, true]);
    if (!it.draft) pieces.push([a0, b0, false]);
    if (it.endApprox && !it.draft) pieces.push([b0, xb, true]);
    pieces.forEach(([p, q, dash], n) => {
      const pa = Math.max(p, x0 - 8), pb = Math.min(q, x1 + 8);
      if (pb > pa) S.z[1].push({ t: 3, k: `bl${n}${it.id}`, a: 1, cls: rcls, x1: pa, y1: ly, x2: pb, y2: ly, stroke, sw, dash });
    });
  } else if (look === 'arrow' && xb <= x1 + 4 && xb - xa > 14) {
    // A migration: the bar ends in an arrow point.
    const tip = Math.min(10, (xb - xa) / 3);
    S.z[1].push({ t: 7, k: `b${it.id}`, a: 1, cls, id: it.id, d: `M${rx} ${by}H${xb - tip}L${xb} ${by + bh / 2}L${xb - tip} ${by + bh}H${rx}Z`, fill: tint(L.color, hot ? 30 : 16), stroke: lit ?? (sel ? 'var(--ink)' : undefined), sw: lit ? 2.5 : 2 });
  } else {
    S.z[1].push({ t: 0, k: `b${it.id}`, a: 1, cls, id: it.id, x: rx, y: by, w: rw, h: bh, r: 2, fill: tint(L.color, hot ? 30 : 16), stroke: lit ?? (sel ? 'var(--ink)' : undefined), sw: lit ? 2.5 : 2 });
  }
  if (!thin && !person && !it.draft) {
    // The start is a solid edge in the lane's pigment, dashed when it's approximate; so is an approximate end.
    if (xa >= x0 - 3) S.z[1].push({ t: 3, k: `ba${it.id}`, a: 1, cls: rcls, x1: xa + 1.5, y1: by, x2: xa + 1.5, y2: by + bh, stroke: L.color, sw: 3, dash: it.approx });
    if (it.endApprox && xb <= x1 + 3) S.z[1].push({ t: 3, k: `bz${it.id}`, a: 1, cls: rcls, x1: xb - 1, y1: by, x2: xb - 1, y2: by + bh, stroke: L.color, sw: 2, dash: true });
  }
  // Its kind's glyph: at the start of a bar that has one, where a thread starts, or standing on a ground line.
  let pad = 8, gx = 0;
  if (thin && xa >= x0 - GLYPH) {
    const g = look === 'ground' ? 18 : 15;
    gx = xa;
    const gy = look === 'ground' ? ly - g + 1 : ly - g / 2;
    if (look === 'thread') S.z[1].push({ t: 1, k: `bd${it.id}`, a: 1, cls: rcls, x: xa, y: ly, r: g / 2 + 1, fill: 'var(--panel)' });
    S.z[1].push({ t: 6, k: `bg${it.id}`, a: 1, cls: `tl-glyph${role}`, id: it.id, x: xa - g / 2, y: gy, w: g, g: it.rep.kind, color });
  } else if (it.rep.badge && vw >= 24) {
    S.z[1].push({ t: 6, k: `bg${it.id}`, a: 1, cls: `tl-glyph${role}`, id: it.id, x: va + 6, y: by + (bh - 14) / 2, w: 14, g: it.rep.kind, color });
    pad = 24;
  }
  // Hit target: the bar, at least 24 px wide, and its label when that sits after it.
  let hx = rx, hw = rw;
  if (hw < MIN_HIT) { hx = rx + rw / 2 - MIN_HIT / 2; hw = MIN_HIT; }
  // Label: inside (above a thin line), else just after if there's room before the next bar in the row, else cut short, else hidden.
  if (vw >= 3) {
    const title = titleOf(it);
    const thumb = !thin && it.thumb && vw >= 64 + pad - 8 ? it.thumb : undefined;
    if (thumb) {
      S.z[1].push({ t: 4, k: `bi${it.id}`, a: 1, cls: `${person ? 'tl-thumb round' : 'tl-thumb'}${role}`, x: va + pad - 4 + (person ? -2 : 0), y: by + (bh - 18) / 2, w: 18, h: 18, href: thumb });
      pad += 18;
    }
    if (thin) pad = gx && va <= gx + 1 ? 12 : 4;
    const lw = M('span', title);
    const ty = thin ? rowTop + 15 : by + bh / 2 + 4.5;
    const ink = it.draft ? UMBER : 'var(--ink)';
    const lcls = `tl-label${role}`;
    if (lw + pad + 6 <= vw) {
      S.z[2].push({ t: 2, k: `bt${it.id}`, a: 1, cls: lcls, id: it.id, x: va + pad, y: ty, s: title, f: it.draft ? 'spanI' : 'span', fill: ink });
    } else {
      const room = (it.nextS === Infinity ? Infinity : c.X(it.nextS)) - xb - 12;
      const after = M('spanI', title);
      if (xb + 6 + after <= x1 && after <= room) {
        S.z[2].push({ t: 2, k: `bt${it.id}`, a: 1, cls: `${lcls} out`, id: it.id, x: xb + 6, y: ty, s: title, f: 'spanI', fill: it.draft ? UMBER : 'var(--ink-2)' });
        hw = Math.max(hw, xb + 6 + after - hx);
      } else {
        const s = vw >= MIN_LABEL ? fit(M, 'span', title, vw - pad - 6) : '';
        if (s) S.z[2].push({ t: 2, k: `bt${it.id}`, a: 1, cls: lcls, id: it.id, x: va + pad, y: ty, s, f: 'span', fill: ink });
      }
    }
  }
  const target: Target = { id: it.id, lane: L.id, x: hx, y: rowTop, w: hw, h: ROW_H };
  S.targets.push(target);
  if (look === 'war') ticks(c, L, it, by, bh, rowTop);
  if (!sel || !V.editable || it.draft) return;
  // The open entry can be dragged: its body moves both dates, an end (when the bar is wide enough to tell them apart) only that one.
  target.grip = 'body';
  if (rw < GRIP_PX * 4) return;
  const grip = (part: 'start' | 'end', x: number) => {
    S.z[2].push({ t: 0, k: `bg${part}${it.id}`, a: 1, cls: 'tl-grip', x: x - 2, y: by + 4, w: 4, h: bh - 8, r: 2, fill: 'var(--ink)' });
    S.targets.push({ id: it.id, grip: part, lane: L.id, x: x - GRIP_PX, y: rowTop, w: GRIP_PX * 2, h: ROW_H });
  };
  if (xa >= x0) grip('start', xa + 1);
  if (!it.open && xb <= x1) grip('end', xb - 1);
}

/** A war's battles: a tick each across its bar, a target 24 px wide on top of the bar's. */
function ticks(c: Ctx, L: PLane, w: PItem, by: number, bh: number, rowTop: number) {
  const { V, S, X, x0, x1 } = c;
  for (const b of w.ticks ?? []) {
    const x = X(b.s);
    if (x < x0 - 2 || x > x1 + 2) continue;
    const sel = V.selected === b.id, hot = sel || V.hover === b.id;
    const role = roleOf(V, b);
    const lit = ROLE_STROKE[role.trim()];
    S.z[2].push({ t: 3, k: `tk${b.id}`, a: 1, cls: `tl-mark tl-tick-mark${sel ? ' selected' : ''}${role}`, id: b.id, x1: x, y1: by - (hot ? 3 : 1), x2: x, y2: by + bh + (hot ? 3 : 1), stroke: lit ?? 'var(--ink)', sw: hot ? 4 : 2.5, dash: b.approx });
    S.boxes.set(b.id, { x: x - 2, y: by, w: 4, h: bh });
    const t: Target = { id: b.id, lane: L.id, x: x - MIN_HIT / 2, y: rowTop, w: MIN_HIT, h: ROW_H };
    if (sel && V.editable) t.grip = 'body';
    S.targets.push(t);
  }
}

/** A work's point joined to its maker's lifeline by a thin line, when both are drawn. */
function ties(c: Ctx) {
  const { D, S } = c;
  for (const L of D.lanes) for (const w of L.events) {
    if (!w.maker) continue;
    const a = S.boxes.get(w.id), b = S.boxes.get(w.maker);
    if (!a || !b) continue;
    const x = a.x + a.w / 2;
    if (x < b.x || x > b.x + b.w) continue;
    const down = b.y > a.y;
    const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y : b.y + b.h;
    const color = D.lanes[D.byId.get(w.maker)!.lane].color;
    S.z[0].push({ t: 3, k: `tie${w.id}`, a: 1, cls: 'tl-tie', x1: x, y1, x2: x, y2, stroke: tint(color, 70), sw: 1.25 });
    S.z[0].push({ t: 1, k: `tied${w.id}`, a: 1, cls: 'tl-tie', x, y: y2, r: 2, fill: color });
  }
}

function sliverCluster(c: Ctx, L: PLane, g: Sliver, rowsTop: number) {
  const { D, V, E, S } = c;
  const lead = pickLead(g.members, D.prominence);
  const rowTop = rowsTop + lead.row * ROW_H;
  const cl: Cluster = { kind: g.kind, count: g.members.length, members: g.members.map((m) => m.id), lead: lead.id, lane: L.id, s: g.members[0].s, e: Math.max(...g.members.map((m) => m.e)) };
  S.clusters.push(cl);
  const n = String(cl.count);
  const w = Math.max(g.right - g.left, E.measure('count', n) + 12);
  const hot = V.hover === `cluster:${lead.id}`;
  const by = rowTop + 4;
  const dim = V.roles && !g.members.some((x) => V.roles!.has(x.id)) ? ' dimmed' : '';
  for (const id of cl.members) S.boxes.set(id, { x: g.left, y: by, w, h: 20 });
  S.z[1].push({ t: 0, k: `sc${lead.id}`, a: 1, cls: `tl-cluster${dim}`, x: g.left, y: by, w, h: 20, r: g.kind === 'person' ? 10 : 3, fill: L.color, stroke: hot ? 'var(--ink)' : undefined, sw: 2 });
  S.z[2].push({ t: 2, k: `sn${lead.id}`, a: 1, cls: dim.trim() || undefined, x: g.left + w / 2, y: by + 14, s: n, f: 'count', fill: 'var(--panel)', anchor: 'middle' });
  const last = g.members[g.members.length - 1];
  const room = Math.min(last.nextS === Infinity ? Infinity : c.X(last.nextS) - 12, c.x1 - 4) - (g.left + w) - 6;
  const label = placeLabel(E.measure, 'spanI', lead.title, room);
  let hw = Math.max(w, MIN_HIT);
  if (label) {
    S.z[2].push({ t: 2, k: `st${lead.id}`, a: 1, cls: `tl-label${dim}`, x: g.left + w + 6, y: by + 14.5, s: label, f: 'spanI', fill: 'var(--ink-2)' });
    hw = w + 6 + E.measure('spanI', label);
  }
  S.targets.push({ id: 'cluster', cluster: cl, lane: L.id, x: g.left, y: rowTop, w: hw, h: ROW_H });
}

/* ---------- arrows, the keyboard's ring and the dragged entry ---------- */

const edges = (b: Box): Edges => ({ left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h });
const ARC_STROKE: Record<string, string> = { ...ROLE_STROKE, draft: UMBER };

/**
 * Where an entry would be drawn when it's in the window's time but scrolled out of view above or
 * below, so an arrow to it runs off that edge toward it (the plot's clip cuts it there).
 */
function offscreen(c: Ctx, id: string): Box | undefined {
  const { D, V, X } = c;
  const it = D.byId.get(id);
  if (!it || it.e < V.win.start || it.s > V.win.end) return undefined;
  const [top, bottom] = rowSpan(D, it);
  const y0 = AXIS_H + top - V.scrollY, y1 = AXIS_H + bottom - V.scrollY;
  if (y1 > c.top && y0 < c.bottom) return undefined;
  if (it.kind === 'event') return { x: X(it.s) - 5, y: y0 + PAD_TOP + ROW_H / 2 - 5, w: 10, h: 10 };
  return { x: X(it.s), y: y0 + 3, w: Math.max(3, X(it.e) - X(it.s)), h: 22 };
}

function arrows(c: Ctx, offscreenToo = true) {
  const { V, S } = c;
  const off = (id: string) => (offscreenToo ? offscreen(c, id) : undefined);
  for (const l of V.links ?? []) {
    const from = S.boxes.get(l.fromId) ?? off(l.fromId), to = S.boxes.get(l.toId) ?? off(l.toId);
    // Both ends must be in the window's time (one may be scrolled out of view), and not in the same cluster.
    if (!from || !to || from === to) continue;
    const { a, b } = anchors(edges(from), edges(to));
    const curve = Math.abs(a.x - b.x) < 6 ? loopCurve(a, b) : arcCurve(a, b);
    const k = `${l.role}${l.fromId}>${l.toId}`;
    const dash = l.role === 'linked' || l.role === 'draft';
    S.z[3].push({ t: 5, k, a: 0.9, cls: `arc ${l.role}`, d: curve.d, stroke: ARC_STROKE[l.role], sw: dash ? 1.5 : 2, dash, head: l.role, from: l.fromId, to: l.toId });
    if (!l.label) continue;
    // The label stays inside the plot, even when the arrow runs off its edge.
    const half = c.E.measure('arc', l.label) / 2 + 4;
    const lx = Math.min(Math.max(curve.mid.x, c.x0 + half), c.x1 - half);
    const ly = Math.min(Math.max(curve.mid.y + 4, c.top + 16), c.bottom - 6);
    S.z[3].push({ t: 2, k: `${k}t`, a: 1, cls: `tl-arc-label ${l.role}`, x: lx, y: ly, s: l.label, f: 'arc', fill: ARC_STROKE[l.role], anchor: 'middle' });
  }
}

function focusRing(c: Ctx) {
  const { V, S } = c;
  const b = V.ring && V.active ? S.boxes.get(V.active) : undefined;
  if (!b) return;
  S.z[3].push({ t: 0, k: 'ring', a: 1, cls: 'tl-ring', x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8, r: 6, stroke: 'var(--focus)', sw: 2 });
}

/** While the open entry is dragged it stays where it was, faded, and a copy shows where it's going, its new dates on the axis. */
function dragPreview(c: Ctx) {
  const { V, D, E, S, X } = c;
  const g = V.drag && D.byId.get(V.drag.id);
  if (!V.drag || !g) return;
  const { s, e, label, y } = V.drag;
  const L = D.lanes[g.lane];
  const xa = X(s), xb = Math.max(X(e), xa + 3);
  for (const p of [...S.z[1], ...S.z[2]]) if (p.id === g.id) p.a = 0.35;
  if (g.kind === 'event') {
    S.z[3].push({ t: 1, k: 'dragm', a: 1, cls: 'tl-dragged', x: xa, y: y + ROW_H / 2, r: 6, fill: L.color, stroke: 'var(--ink)', sw: 2 });
  } else {
    const bh = g.kind === 'person' ? 20 : 22;
    const by = y + (ROW_H - bh) / 2;
    S.z[3].push({ t: 0, k: 'dragb', a: 1, cls: 'tl-dragged', x: xa, y: by, w: xb - xa, h: bh, r: g.kind === 'person' ? bh / 2 : 2, fill: tint(L.color, 30), stroke: 'var(--ink)', sw: 2 });
  }
  const w = E.measure('play', label) + 14;
  const cx = Math.min(Math.max((xa + xb) / 2, c.x0 + w / 2), c.x1 - w / 2);
  S.axis.push({ t: 0, k: 'dragc', a: 1, x: cx - w / 2, y: AXIS_H - 22, w, h: 19, r: 4, fill: 'var(--focus)' });
  S.axis.push({ t: 2, k: 'dragt', a: 1, cls: 'tl-drag-date', x: cx, y: AXIS_H - 8.5, s: label, f: 'play', fill: 'var(--panel)', anchor: 'middle' });
}

/* ---------- axis, today and the playhead ---------- */

function axis(c: Ctx, level: Level) {
  const { V, E, S, X, x0, x1 } = c;
  // Level 0's axis keeps Spectral's old-style numerals.
  const [minor, major] = level === 0 ? ['tick0', 'tick0B'] as const : ['tick', 'tickB'] as const;
  const ts = axisTicks(V.win.start, V.win.end, x1 - x0, 78);
  S.axis.unshift({ t: 0, k: 'abg', a: 1, x: x0, y: 0, w: x1 - x0, h: AXIS_H, fill: 'var(--panel)' }, { t: 3, k: 'arule', a: 1, x1: x0, y1: AXIS_H - 0.5, x2: x1, y2: AXIS_H - 0.5, stroke: 'var(--rule)' });
  const ax: Prim[] = [];
  for (const t of ts.ticks) {
    const x = X(t.y);
    if (x < x0 - 40 || x > x1 + 40) continue;
    S.z[0].push({ t: 3, k: `g${t.y}`, a: 1, x1: x, y1: AXIS_H, x2: x, y2: E.h, stroke: t.major ? 'var(--rule)' : 'var(--rule-soft)' });
    ax.push({ t: 3, k: `ak${t.y}`, a: 1, x1: x, y1: AXIS_H - (t.major ? 7 : 4), x2: x, y2: AXIS_H, stroke: 'var(--ink-2)' });
    // A label that would be cut off at either edge is left out; its tick stays.
    const half = E.measure(t.major ? major : minor, t.label) / 2;
    if (x - half < x0 || x + half > x1) continue;
    ax.push({ t: 2, k: `at${t.y}`, a: 1, cls: 'tl-tick', x, y: ts.heads.length ? 18 : 26, s: t.label, f: t.major ? major : minor, fill: t.major ? 'var(--ink)' : 'var(--ink-2)', anchor: 'middle' });
  }
  // Month or year headings above day or month ticks, pinned to the left edge while they're in view.
  for (let i = 0; i < ts.heads.length; i++) {
    const h = ts.heads[i];
    const next = i + 1 < ts.heads.length ? X(ts.heads[i + 1].y) : Infinity;
    const x = Math.max(X(h.y), x0) + 4;
    if (next < x0 || x > x1 || next - x < 40) continue;
    ax.push({ t: 2, k: `ah${h.y}`, a: 1, x, y: 34, s: h.label, f: 'head', fill: 'var(--muted)' });
  }
  // Ticks sit under the drag chip, if there is one.
  S.axis.splice(2, 0, ...ax);
  const now = X(V.now);
  if (now >= x0 && now <= x1) S.axis.push({ t: 3, k: 'now', a: 0.5, x1: now, y1: AXIS_H, x2: now, y2: E.h, stroke: 'var(--pig-cinnabar)', sw: 2 });
  if (V.playYear !== undefined) {
    const px = X(V.playYear);
    if (px >= x0 - 1 && px <= x1 + 1) {
      const label = formatYear(Math.floor(V.playYear));
      const w = E.measure('play', label) + 12;
      // The year sits on the axis, over the tick labels, so it never covers an entry.
      S.axis.push({ t: 3, k: 'play', a: 1, cls: 'tl-playhead', x1: px, y1: AXIS_H - 4, x2: px, y2: E.h, stroke: 'var(--ink)', sw: 2 });
      S.axis.push({ t: 0, k: 'playm', a: 1, x: px - w / 2, y: AXIS_H - 22, w, h: 19, r: 4, fill: 'var(--ink)' });
      S.axis.push({ t: 2, k: 'playt', a: 1, cls: 'tl-year', x: px, y: AXIS_H - 8.5, s: label, f: 'play', fill: 'var(--panel)', anchor: 'middle' });
      // The playhead is the top target, so it can be dragged even over an entry.
      S.targets.push({ id: 'playhead', x: px - Math.max(8, w / 2), y: AXIS_H - 22, w: Math.max(16, w), h: 22 });
      S.targets.push({ id: 'playhead', x: px - 6, y: AXIS_H, w: 12, h: E.h - AXIS_H });
    }
  }
}

/** What's under a point: the last target drawn there wins. The gutter hits nothing. */
export function hitTest(S: Scene, x: number, y: number): Target | undefined {
  for (let i = S.targets.length - 1; i >= 0; i--) {
    const t = S.targets[i];
    if (x < S.plot.x && !t.gutter) continue;
    // Over the axis only the playhead's year answers; entries scrolled under it don't.
    if (y < S.plot.y && t.id !== 'playhead') continue;
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t;
  }
  return undefined;
}

/** The lane at a height on screen, for adding an entry where Bob double-clicked. */
export function laneAt(D: Prepared, scrollY: number, y: number): PLane | undefined {
  const cy = y - AXIS_H + scrollY;
  return D.lanes.find((l) => cy >= l.top && cy < l.top + l.height);
}

export type { Prim, Scene, Target, Cluster };
