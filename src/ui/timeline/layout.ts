import { axisTicks, formatRange, formatYear, toDecimalYear } from '../../model/dates';
import { ELSEWHERE, type Era, type EraRegion } from '../../model/eras';
import type { OGroup, OPolity, Overview } from '../../model/overview';
import { areaWeight, strengthAt, strengthKnown, stripShare, UNKNOWN_SHARE } from '../../model/strength';
import { LANES, type DatedItem, type Lane, type Relation, type TimelineItem } from '../../model/types';
import { anchors, arcCurve, loopCurve, type Box as Edges } from '../influenceLinks';
import { makerOf, markOf, representationOf, warOf, type Representation } from '../representations';
import { innerPrims, washPrims } from '../representations/era';
import { stripPrims, type StripLook } from '../representations/polity';
import type { YearWindow } from '../timeNav';
import { LANE_LABEL, PIGMENT } from '../util';
import { tint, type Box, type Cluster, type Link, type MarkKind, type Measure, type Prim, type Scene, type Target } from './scene';

/**
 * The new timeline's layout: pure. `prepare` runs once per data change (lanes, rows, sorted
 * indexes); `layout` runs every frame and returns only what is visible.
 *
 * Level 0 is the overview: a band per region with its polities as strips (`representations/polity.ts`)
 * over its eras (`representations/era.ts`), world events in gold, and the entries Bob shows at the
 * top. Level 1 is one era opened into its six lanes (`eraLanes`). Level 2 is single entries in
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
  /** A world event (gold on the overview). */
  world?: boolean;
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

/** An era: the row it sits in inside its region (level 1 opens it from there). */
export interface PEra extends Era { row: number }
export interface PRegion {
  name: string;
  /** Its name, or "Elsewhere". */
  label: string;
  highlights: number;
  eras: PEra[];
  rows: number;
}

/** Level 0: a polity, whether anything is known of its strength, and which of its tone's two shades it takes. */
export interface PPolity extends OPolity { unknown: boolean; alt: boolean }
/** Level 0: a group of city-states, folded into one strip until it's clicked. */
export interface PGroup extends Omit<OGroup, 'members'> { members: PPolity[]; alt: boolean }
export type Slot = { pol: PPolity; group?: undefined } | { group: PGroup; pol?: undefined };
/** A world event gilding a band: named there if it's its home. */
export interface PWorld { it: PItem; home: boolean }
/** Level 0: a region's band. */
export interface PBand {
  name: string;
  label: string;
  parent?: string;
  /** The first band under its parent carries the parent's rule. */
  parentHead: boolean;
  tone: number;
  /** Sub-rows, with groups folded: a succession shares one. */
  subs: Slot[][];
  /** Its eras, outer ones first: the backdrop. */
  eras: PEra[];
  worlds: PWorld[];
  /** Whether any world event is named here, which gives it a line of its own. */
  named: boolean;
}
export interface Prepared {
  lanes: PLane[];
  byId: Map<string, PItem>;
  contentH: number;
  prominence: (id: string) => number;
  /** From the earliest start to the latest end, for "Show everything". */
  extent?: YearWindow;
  /** Level 1: regions with their eras. */
  regions: PRegion[];
  /** Level 0: bands in their order, the top row, and the years they cover. */
  bands: PBand[];
  top: PItem[];
  polById: Map<string, PPolity>;
  groupById: Map<string, PGroup>;
  overviewExtent?: YearWindow;
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
  /** Level 0's eras and level 1's: the eras in their regions (`eraRegions`). */
  eras?: EraRegion[];
  /** Level 0: the overview (`overview` in `src/model/overview.ts`). */
  overview?: Overview;
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
      lane: li, row: 0, nextS: Infinity, thumb: draft ? undefined : o.thumbFor?.(ref), world: ref.overview === 'world' || undefined,
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
  const eras = prepareEras(o.eras ?? [], byId);
  return { lanes: out, byId, contentH: top, prominence, extent: lo <= hi ? { start: lo, end: hi } : undefined, ...eras, ...prepareOverview(o.overview, eras.regions, byId) };
}

/** The eras in each region. Inside one, eras pack into rows by time only, outer eras above the eras inside them. */
function prepareEras(input: EraRegion[], byId: Map<string, PItem>): Pick<Prepared, 'regions'> {
  const regions = input.map((r): PRegion => {
    const shown = r.eras.filter((e) => byId.has(e.id) && !byId.get(e.id)!.draft);
    const ids = new Set(shown.map((e) => e.id));
    const byEra = new Map(shown.map((e) => [e.id, e]));
    const depth = (e: Era) => { let d = 0; for (let p = e.parent; p && ids.has(p) && d < 50; p = byEra.get(p)!.parent) d++; return d; };
    const eras = shown.map((e): PEra => ({ ...e, row: 0 }));
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
    return { name: r.name, label: r.name === ELSEWHERE ? 'Elsewhere' : r.name, highlights: r.highlights, eras, rows: rowEnd.length };
  }).filter((r) => r.eras.length);
  return { regions };
}

/**
 * Level 0's bands, in the overview's order. Inside a band, polities (and folded groups) pack
 * into sub-rows by time only, so a succession shares one and rows stay put while zooming.
 */
function prepareOverview(O: Overview | undefined, regions: PRegion[], byId: Map<string, PItem>): Pick<Prepared, 'bands' | 'top' | 'polById' | 'groupById' | 'overviewExtent'> {
  const polById = new Map<string, PPolity>(), groupById = new Map<string, PGroup>();
  let lo = Infinity, hi = -Infinity;
  const span = (s: number, e: number) => { lo = Math.min(lo, s); hi = Math.max(hi, e); };
  for (const R of regions) for (const e of R.eras) span(e.s, e.e);
  const top = (O?.top ?? []).map((id) => byId.get(id)).filter((p): p is PItem => !!p && !p.draft);
  for (const it of top) span(it.s, it.e);
  if (!O) return { bands: [], top, polById, groupById, overviewExtent: lo <= hi ? { start: lo, end: hi } : undefined };
  for (const p of O.polities) { polById.set(p.id, { ...p, unknown: !strengthKnown(p.t), alt: false }); span(p.s, p.e); }
  for (const g of O.groups) groupById.set(g.id, { ...g, members: g.members.map((id) => polById.get(id)!), alt: false });
  const eraRegion = new Map(regions.map((R) => [R.name, R]));
  let lastParent: string | undefined;
  const bands = O.regions.map((r, i): PBand => {
    const slots: Slot[] = [
      ...[...groupById.values()].filter((g) => g.region === r.name).map((group) => ({ group })),
      ...[...polById.values()].filter((p) => p.region === r.name && !p.group).map((pol) => ({ pol })),
    ];
    const s0 = (x: Slot) => (x.pol ?? x.group).s, e0 = (x: Slot) => (x.pol ?? x.group).e;
    slots.sort((a, b) => s0(a) - s0(b) || e0(b) - e0(a) || (a.pol ?? a.group).id.localeCompare((b.pol ?? b.group).id));
    const subs: Slot[][] = [], ends: number[] = [];
    for (const x of slots) {
      let k = ends.findIndex((end) => end <= s0(x));
      if (k < 0) { k = subs.length; subs.push([]); }
      // Neighbours in a succession take the two shades in turn.
      const alt = subs[k].length % 2 === 1;
      if (x.pol) x.pol.alt = alt; else { x.group.alt = alt; x.group.members.forEach((m, j) => (m.alt = j % 2 === 1)); }
      subs[k].push(x);
      ends[k] = e0(x);
    }
    const worlds = O.worlds.filter((w) => w.touches.includes(r.name) && byId.has(w.id)).map((w) => ({ it: byId.get(w.id)!, home: w.home === r.name }));
    for (const w of worlds) span(w.it.s, w.it.e);
    const eras = [...(eraRegion.get(r.name)?.eras ?? [])].sort((a, b) => a.row - b.row || a.s - b.s);
    const parentHead = !!r.parent && (i === 0 || r.parent !== lastParent);
    lastParent = r.parent;
    return { name: r.name, label: r.label, parent: r.parent, parentHead, tone: r.tone, subs, eras, worlds, named: worlds.some((w) => w.home) };
  });
  return { bands, top, polById, groupById, overviewExtent: lo <= hi ? { start: lo, end: hi } : undefined };
}

/* ---------- level 0 geometry ---------- */

/** Below this width levels 0 and 1 have no gutter: each region's name sits on its band. */
export const PHONE_W = 600;
/** The top row: entries Bob shows in the overview, in up to three rows. */
const TOP_ROWS = 3;
const TOP_ROW_H = 20;
const TOP_PAD = 6;
const PARENT_H = 24;
/** A band, top to bottom: the gold of world events, the line with its eras' names, a line naming its world events, then its sub-rows. */
const GOLD_H = 9;
const HEAD_LINE = 18;
const WORLD_LINE = 16;
const SUB_H = 32;
const SUB_H_PHONE = 30;
const EMPTY_H = 22;
const BAND_PAD = 6;
/** The gap between bands, kept free for threads (Phase 4b). */
const BAND_GAP = 10;

/** A sub-row on screen: what's in it, how tall and how faded (a group's members while it unfolds), and the group whose members it holds. */
interface SubGeo { slots: Slot[]; y: number; h: number; a: number; group?: PGroup; folding?: number }
interface BandGeo { B: PBand; top: number; bottom: number; empty: boolean; headY: number; worldY: number; subs: SubGeo[] }
interface Geo { topH: number; bands: BandGeo[]; H: number }

const inWin = (x: { s: number; e: number }, win: YearWindow) => x.e >= win.start && x.s <= win.end;
const unfoldOf = (V: Pick<View, 'unfolded'>, id: string) => V.unfolded?.get(id) ?? 0;

/** Where every band and sub-row sits, in px from the top of the content (under the axis). */
function overviewGeo(D: Prepared, V: Pick<View, 'win' | 'unfolded'>, phone: boolean): Geo {
  const sub = phone ? SUB_H_PHONE : SUB_H;
  const topH = D.top.length ? TOP_PAD * 2 + Math.min(TOP_ROWS, D.top.length) * TOP_ROW_H : 0;
  let y = topH;
  const bands = D.bands.map((B): BandGeo => {
    if (B.parentHead) y += PARENT_H;
    const top = y;
    const headY = top + GOLD_H + 13;
    y += GOLD_H + HEAD_LINE;
    const worldY = y + 12;
    if (B.named) y += WORLD_LINE;
    // A band with no polities in the years in view is one thin row that says so.
    const empty = !B.subs.some((row) => row.some((x) => inWin(x.pol ?? x.group, V.win)));
    const subs: SubGeo[] = [];
    if (empty) y += EMPTY_H;
    else for (const row of B.subs) {
      const groups = row.flatMap((x) => (x.group ? [x.group] : []));
      const most = Math.max(0, ...groups.map((g) => unfoldOf(V, g.id)));
      // A row of folded groups only gives way to their members as they unfold.
      const h = groups.length === row.length ? sub * (1 - most) : sub;
      subs.push({ slots: row, y, h, a: 1 });
      y += h;
      for (const g of groups) {
        const f = unfoldOf(V, g.id);
        if (f <= 0) continue;
        for (const m of g.members) { subs.push({ slots: [{ pol: m }], y, h: sub * f, a: f, group: g, folding: f }); y += sub * f; }
      }
    }
    y += BAND_PAD;
    const bottom = y;
    y += BAND_GAP;
    return { B, top, bottom, empty, headY, worldY, subs };
  });
  return { topH, bands, H: y };
}

/** How far down level 0 an era's band is, in px from the top of the content. */
export function eraSpan(D: Prepared, V: Pick<View, 'win' | 'unfolded'>, id: string, phone: boolean): [number, number] | undefined {
  const g = overviewGeo(D, V, phone).bands.find((b) => b.B.eras.some((e) => e.id === id));
  return g && [g.top, g.bottom];
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
  /** Entries box-selected for bulk edit, each ringed. */
  picked?: ReadonlySet<string>;
  /** Level 0: the strip or world event picked (`pol:<territory>`, or a world event's id), outlined in ink. */
  pick?: string;
  /** Level 0: how far open each group is (0 folded, 1 open), while it unfolds and after. */
  unfolded?: ReadonlyMap<string, number>;
  /** The box Bob is drawing with ⌘ or Ctrl held, in px. */
  box?: Box;
}

export interface Env {
  w: number;
  h: number;
  /** Width of the lane names on the left. */
  gutter: number;
  measure: Measure;
}

interface Ctx { D: Prepared; V: View; E: Env; S: Scene; X: (y: number) => number; x0: number; x1: number; top: number; bottom: number }

/** How far the lanes (or, at level 0, the bands; at level 1, the open era's lanes) can scroll. `V` is the view, for level 0's and 1's. */
export function maxScroll(D: Prepared, h: number, level: Level = 2, w = Infinity, V?: Pick<View, 'win' | 'unfolded' | 'era'>): number {
  if (level === 1 && V?.era) return Math.max(0, lanesH(V.era, w < PHONE_W) - (h - AXIS_H - HEAD1_H) + 8);
  const content = level === 0 && V ? overviewGeo(D, V, w < PHONE_W).H : D.contentH;
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
    contentH: level === 0 ? overviewGeo(D, V, E.w < PHONE_W).H : level === 1 && V.era ? lanesH(V.era, E.w < PHONE_W) : D.contentH,
  };
  const span = V.win.end - V.win.start;
  const ppy = (x1 - x0) / span;
  const X = (y: number) => x0 + (y - V.win.start) * ppy;
  const c: Ctx = { D, V, E, S, X, x0, x1, top: AXIS_H, bottom: E.h };

  if (level === 0) {
    overviewRows(c);
    arrows(c);
    picks(c);
    focusRing(c);
    axis(c, level);
    return S;
  }
  if (level === 1 && V.era) {
    eraLevel(c, V.era);
    if (!V.zoom) arrows(c, false);
    if (!V.zoom) picks(c);
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
  picks(c);
  focusRing(c);
  dragPreview(c);
  axis(c, level);
  return S;
}

/* ---------- level 0: the overview ---------- */

/** A world event's gold: a bar along the band's top (thinner away from home), or a dot for a moment. */
function gold(c: Ctx, w: PItem, y: number, home: boolean, k: string, h = home ? 7 : 3) {
  const { V, S, X } = c;
  const xa = X(w.s), xb = Math.max(xa + 2, X(w.e));
  const picked = V.pick === w.id || V.selected === w.id;
  const sw = picked ? 1.6 : 0.6;
  const role = roleOf(V, w);
  if (xb - xa > 6) S.z[1].push({ t: 0, k: `wg${k}`, a: 1, cls: `tl-world${role}`, id: w.id, x: xa, y, w: xb - xa, h, r: 1.5, fill: 'gilt', stroke: 'var(--gold-ink)', sw });
  else S.z[1].push({ t: 1, k: `wg${k}`, a: 1, cls: `tl-world${role}`, id: w.id, x: xa, y: y + h / 2, r: home ? 4.5 : 2.5, fill: 'gilt', stroke: 'var(--gold-ink)', sw: picked ? 1.6 : 0.8 });
  return [xa, xb] as const;
}

function overviewRows(c: Ctx) {
  const { D, V, E, S, x0, x1 } = c;
  if (!D.bands.length && !D.top.length) {
    const cx = (x0 + x1) / 2, cy = AXIS_H + Math.min(120, (E.h - AXIS_H) / 3);
    S.z[2].push({ t: 2, k: 'empty', a: 1, cls: 'tl-empty', x: cx, y: cy, s: 'Nothing in the overview yet', f: 'era', fill: 'var(--ink-2)', anchor: 'middle' });
    S.z[2].push({ t: 2, k: 'empty2', a: 1, cls: 'tl-empty', x: cx, y: cy + 22, s: 'Polities and periods you add show here, in a band for each region.', f: 'ui', fill: 'var(--muted)', anchor: 'middle' });
    return;
  }
  const phone = E.w < PHONE_W;
  const G = overviewGeo(D, V, phone);
  const base = AXIS_H - V.scrollY;
  // The widest polity in view fills its row: the rest are scaled to it.
  let widest = 0;
  for (const p of D.polById.values()) {
    if (!inWin(p, V.win) || p.t.strength?.length) continue;
    const a = Math.max(p.s, V.win.start), b = Math.min(p.e, V.win.end);
    for (let k = 0; k <= 24; k++) {
      const st = strengthAt(p.t, a + ((b - a) * k) / 24);
      if (st.by === 'area') widest = Math.max(widest, areaWeight(st.km2));
    }
  }
  const shareOf = (p: PPolity) => (p.unknown ? () => UNKNOWN_SHARE : (y: number) => stripShare(strengthAt(p.t, y), widest));
  if (G.topH) topRow(c, base, G.topH);
  for (const g of G.bands) {
    const top = base + g.top, bottom = base + g.bottom;
    if (g.B.parentHead) parentRule(c, g.B, top - PARENT_H, phone);
    if (bottom < AXIS_H || top > E.h) continue;
    band(c, g, base, phone, shareOf);
  }
}

function parentRule(c: Ctx, B: PBand, y: number, phone: boolean) {
  const { E, S, x0, x1 } = c;
  if (y + PARENT_H < AXIS_H || y > E.h) return;
  const label = B.parent!.toUpperCase();
  const ry = y + PARENT_H - 8.5;
  if (phone) {
    const w = E.measure('parent', label);
    S.z[2].push({ t: 2, k: `pr${B.name}`, a: 1, cls: 'tl-parent', x: x0 + 12, y: ry + 4, s: label, f: 'parent', fill: 'var(--muted)' });
    S.z[0].push({ t: 3, k: `prl${B.name}`, a: 1, x1: x0 + 20 + w, y1: ry, x2: x1, y2: ry, stroke: 'var(--rule)' });
  } else {
    S.gutter.push({ t: 2, k: `pr${B.name}`, a: 1, cls: 'tl-parent', x: 14, y: ry + 4, s: fit(E.measure, 'parent', label, E.gutter - 20), f: 'parent', fill: 'var(--muted)' });
    S.z[0].push({ t: 3, k: `prl${B.name}`, a: 1, x1: x0, y1: ry, x2: x1, y2: ry, stroke: 'var(--rule)' });
  }
}

function band(c: Ctx, g: BandGeo, base: number, phone: boolean, shareOf: (p: PPolity) => (y: number) => number) {
  const { D, V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const B = g.B;
  const top = base + g.top, bottom = base + g.bottom, headY = base + g.headY;
  S.z[0].push({ t: 0, k: `bb${B.name}`, a: 1, cls: 'tl-band', x: x0, y: top, w: x1 - x0, h: bottom - top, fill: 'var(--band)' });
  // The region's name: on the band on a phone, in the gutter (staying in view while it scrolls past) otherwise.
  let after = x0 + 6;
  if (phone) {
    const name = fit(M, 'region', B.label, x1 - x0 - 24);
    S.z[2].push({ t: 2, k: `rn${B.name}`, a: 1, cls: 'tl-region', x: x0 + 12, y: headY, s: name, f: 'region', fill: 'var(--ink)' });
    after = x0 + 12 + M('region', name) + 14;
  } else {
    const ny = Math.min(Math.max(headY, AXIS_H + 18), bottom - 6);
    S.gutter.push({ t: 2, k: `rn${B.name}`, a: 1, cls: 'tl-region', x: 14, y: ny, s: fit(M, 'region', B.label, E.gutter - 24), f: 'region', fill: 'var(--ink)' });
    const gy = bottom + BAND_GAP / 2 - 0.5;
    S.gutter.push({ t: 3, k: `gr${B.name}`, a: 1, x1: 0, y1: gy, x2: E.gutter, y2: gy, stroke: 'var(--rule-soft)' });
  }
  // Eras are the backdrop: a wash across the band each, inner ones a rule along its foot.
  const outer = B.eras.filter((e) => !e.parent || !B.eras.some((o) => o.id === e.parent));
  outer.forEach((e, i) => {
    if (e.e < V.win.start || e.s > V.win.end) return;
    const xa = X(e.s), xb = Math.max(X(e.e), xa + 1);
    const role = roleOf(V, D.byId.get(e.id)!);
    const { marks, text } = washPrims(e, { xa, xb, x0, x1, top, bottom, nameY: headY, after, alt: i % 2 === 1, selected: V.selected === e.id, role }, M);
    S.z[0].push(...marks);
    S.z[2].push(...text);
    const rx = Math.max(xa, x0), rw = Math.min(xb, x1) - rx;
    if (rw > 0) S.targets.push({ id: e.id, x: rx, y: top, w: Math.max(rw, 4), h: bottom - top });
  });
  for (const e of B.eras) {
    if (outer.includes(e) || e.e < V.win.start || e.s > V.win.end) continue;
    const { marks, text } = innerPrims(e, { xa: X(e.s), xb: X(e.e), x0, x1, bottom, role: roleOf(V, D.byId.get(e.id)!) }, M);
    S.z[0].push(...marks);
    S.z[2].push(...text);
  }
  if (g.empty) S.z[2].push({ t: 2, k: `be${B.name}`, a: 1, cls: 'tl-band-empty', x: x0 + 12, y: top + GOLD_H + HEAD_LINE + (B.named ? WORLD_LINE : 0) + 15, s: 'No polities in these years', f: 'ui', fill: 'var(--muted)' });
  // World events: gold along the top of every band they touched, named on a line of their own at home.
  const named: [number, number][] = [];
  for (const { it, home } of B.worlds) {
    if (it.e < V.win.start || it.s > V.win.end) continue;
    const [xa, xb] = gold(c, it, top + 1, home, `${B.name}:${it.id}`);
    S.targets.push({ id: it.id, x: xa - 4, y: top, w: Math.max(8, xb - xa + 8), h: GOLD_H + 3 });
    if (!S.boxes.has(it.id)) S.boxes.set(it.id, { x: xa, y: top + 1, w: Math.max(2, xb - xa), h: 7 });
    if (!home) continue;
    // From where it starts, slid left if it would run off the right edge.
    const w = M('world', it.title), lx = Math.max(Math.min(xa, x1 - 4 - w), x0 + 12);
    if (lx + w > x1 - 4 || named.some(([a, b]) => lx < b && lx + w > a)) continue;
    named.push([lx - 4, lx + w + 10]);
    S.z[2].push({ t: 2, k: `wn${B.name}:${it.id}`, a: 1, cls: `tl-world-name${roleOf(V, it)}`, id: it.id, x: lx, y: base + g.worldY, s: it.title, f: 'world', fill: 'var(--gold-text)' });
    S.targets.push({ id: it.id, x: lx - 2, y: base + g.worldY - 13, w: w + 4, h: 17 });
    if (V.pick === it.id) openPill(c, Math.min(lx + w + 10, x1 - M('ui', OPEN_LABEL) - 24), base + g.worldY - 4.5);
  }
  // Polities: strips in their sub-rows.
  const tone = `var(--tone-${(B.tone % 3) + 1}`;
  for (const sg of g.subs) {
    const y = base + sg.y;
    if (sg.h < 2 || y + sg.h < AXIS_H || y > E.h) continue;
    const cy = y + sg.h / 2, T = Math.max(0, sg.h - 8);
    const pad = (V.win.end - V.win.start) * 0.02;
    for (const x of sg.slots) {
      const o = x.pol ?? x.group;
      const a = Math.max(o.s, V.win.start - pad), b = Math.min(o.e, V.win.end + pad);
      if (b <= a) continue;
      const fold = x.group ? 1 - unfoldOf(V, x.group.id) : sg.a;
      if (fold <= 0.01) continue;
      const tid = x.pol ? `pol:${x.pol.id}` : `grp:${x.group.id}`;
      const fill = `${tone}${o.alt ? '-2' : ''})`;
      const look: StripLook = {
        a, b, X, cy, T, fill, left: x0, right: x1,
        share: x.pol ? shareOf(x.pol) : groupShare(x.group, shareOf),
        unknown: !!x.pol?.unknown,
        picked: V.pick === tid || (!!x.pol?.itemId && V.selected === x.pol.itemId),
        hot: V.hover === tid,
        approxAt: x.pol?.approx && X(o.s) >= x0 ? X(o.s) : undefined,
        name: x.pol ? x.pol.title : `▸ ${x.group.title}`,
        sub: x.group?.members.map((m) => m.title).join(' · '),
      };
      const { marks, text } = stripPrims(tid, tid, look, M, fold);
      S.z[1].push(...marks);
      S.z[2].push(...text);
      // The whole row is its hit area, so a sliver can still be picked.
      if (fold > 0.5) S.targets.push({ id: tid, x: X(a), y: y + 2, w: Math.max(4, X(b) - X(a)), h: Math.max(4, sg.h - 4) });
      // Picked: "Open ▾" after its name, or at the right while its name is hidden.
      if (x.pol && V.pick === tid && fold > 0.5) {
        const named = text.find((p) => p.t === 2 && p.k === `pn${tid}`);
        const after = named?.t === 2 ? named.x + M('pol', named.s) + 10 : Math.max(X(a), x0) + 8;
        openPill(c, Math.min(after, x1 - M('ui', OPEN_LABEL) - 24), cy);
      }
    }
    // The bracket that folds a group back, along its members' rows.
    if (sg.group && sg.group.members[0] === sg.slots[0].pol) {
      const n = sg.group.members.length, h = sg.h * n;
      S.z[2].push({ t: 7, k: `gb${sg.group.id}`, a: sg.a, cls: 'tl-bracket', d: `M${x0 + 9} ${y + 3}H${x0 + 3}V${y + h - 3}H${x0 + 9}`, fill: 'none', stroke: 'var(--ink-2)', sw: 1.3 });
      if (sg.a > 0.5) S.targets.push({ id: `grp:${sg.group.id}`, x: x0, y, w: 12, h });
    }
  }
  // Inner eras answer along the foot, over the strips.
  for (const e of B.eras) {
    if (outer.includes(e) || e.e < V.win.start || e.s > V.win.end || X(e.e) - X(e.s) < 70) continue;
    S.targets.push({ id: e.id, x: Math.max(X(e.s), x0), y: bottom - 9, w: Math.min(X(e.e), x1) - Math.max(X(e.s), x0), h: 9 });
  }
}

const OPEN_LABEL = 'Open ▾';

/** The pill on what's picked that opens it into its six lanes. */
function openPill(c: Ctx, x: number, cy: number) {
  const { V, E, S } = c;
  const w = E.measure('ui', OPEN_LABEL) + 16, h = 20, hot = V.hover === OPEN_PICK;
  S.z[3].push({ t: 0, k: 'open', a: 1, cls: 'tl-open-pill', x, y: cy - h / 2, w, h, r: h / 2, fill: hot ? 'var(--ink)' : 'var(--panel)', stroke: 'var(--ink)', sw: 1 });
  S.z[3].push({ t: 2, k: 'opent', a: 1, cls: 'tl-open-pill', x: x + 8, y: cy + 4, s: OPEN_LABEL, f: 'ui', fill: hot ? 'var(--panel)' : 'var(--ink)' });
  S.targets.push({ id: OPEN_PICK, x: x - 2, y: cy - Math.max(h, MIN_HIT) / 2, w: w + 4, h: Math.max(h, MIN_HIT) });
}

/** A folded group is as thick as its members together: each adds its share, overlapping a little. */
const groupShare = (g: PGroup, shareOf: (p: PPolity) => (y: number) => number) => {
  const fs = g.members.map((m) => [m, shareOf(m)] as const);
  return (y: number) => 1 - fs.reduce((acc, [m, f]) => (y >= m.s && y <= m.e ? acc * (1 - f(y) * 0.7) : acc), 1);
};

/** The top row: entries Bob shows in the overview as their kind's glyph and name, most prominent first, in up to three rows. */
function topRow(c: Ctx, base: number, h: number) {
  const { D, V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const y0 = base + TOP_PAD;
  if (y0 + h < AXIS_H) return;
  const taken: [number, number][][] = Array.from({ length: TOP_ROWS }, () => []);
  for (const it of D.top) {
    if (it.e < V.win.start || it.s > V.win.end) continue;
    const xa = X(it.s), xb = Math.max(xa, X(it.e));
    const label = titleOf(it), lw = M('ui', label);
    const gx = xa - GLYPH / 2;
    const span: [number, number] = [gx - 4, xb + 8 + lw + 6];
    if (span[1] < x0 || span[0] > x1) continue;
    const row = taken.findIndex((t) => !t.some(([a, b]) => span[0] < b && span[1] > a));
    if (row < 0) continue;
    taken[row].push(span);
    const cy = y0 + row * TOP_ROW_H + TOP_ROW_H / 2;
    const role = roleOf(V, it);
    const hot = V.hover === it.id;
    // A world event no polity places is gold up here.
    if (it.world) gold(c, it, cy - 4, true, `top:${it.id}`, 8);
    else {
      if (xb - xa > 2) S.z[1].push({ t: 3, k: `tl${it.id}`, a: 1, cls: `tl-top-span${role}`, id: it.id, x1: xa, y1: cy, x2: xb, y2: cy, stroke: 'var(--ink-2)', sw: 2 });
      if (hot) S.z[2].push({ t: 1, k: `th${it.id}`, a: 1, x: xa, y: cy, r: GLYPH / 2 + 2, fill: 'var(--panel)', stroke: 'var(--ink)', sw: 1.5 });
      S.z[2].push({ t: 6, k: `tg${it.id}`, a: 1, cls: `tl-top${role}`, id: it.id, x: gx, y: cy - GLYPH / 2, w: GLYPH, g: it.rep.kind, color: 'var(--ink-2)' });
    }
    S.z[2].push({ t: 2, k: `tt${it.id}`, a: 1, cls: `tl-top-name${role}`, id: it.id, x: xb + 8, y: cy + 4, s: label, f: 'ui', fill: 'var(--ink)' });
    S.boxes.set(it.id, { x: gx, y: cy - GLYPH / 2, w: Math.max(GLYPH, xb - gx), h: GLYPH });
    S.targets.push({ id: it.id, x: gx - 2, y: cy - TOP_ROW_H / 2, w: span[1] - gx, h: TOP_ROW_H });
  }
}

/* ---------- level 1: an era opened into six lanes ---------- */

/** The lane under the six for entries in no lane yet. */
export const NO_LANE = 'none';
/** Level 1's "All eras", in the header row. */
export const ERAS_BACK = '__eras';
/** The header row itself, so a tap on it lands on nothing under it. */
export const HEAD_ROW = '__head';
/** Level 1 in a polity: a lane's name (or a closed lane), which opens or closes it; followed by the lane's id. */
export const LANE_TOGGLE = '__lane:';
/** Level 0: the "Open ▾" pill on the picked strip or world event. */
export const OPEN_PICK = '__open';
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
  /** Highlights in the era in this lane, or (in a polity) how many entries it has. */
  count: number;
  /** The count in words, under its name: "12 highlights", "5 entries". */
  countLabel: string;
  /** Spans of change (periods, lives) and key moments, each by start. */
  spans: PItem[];
  moments: PItem[];
  /** Every entry by start: the arrow keys' order, and the phone's list. */
  order: PItem[];
  /** Every entry, most prominent first: a closed lane names the first that fit. */
  ranked: PItem[];
  rows: number;
}

/** What level 1 has open: an era, or a polity or world event picked on the overview. */
export interface Head1 {
  /** The era's id, or the overview's pick (`pol:<territory>`, or a world event's id). */
  id: string;
  title: string;
  /** Its years, washed behind the lanes, and the years to frame when it opens. */
  s: number;
  e: number;
  fit: { s: number; e: number };
  when: string;
  /** After its dates: "38 highlights", "49 entries". */
  sub: string;
  /** The entry its name opens, if any. */
  opens?: string;
  /** "‹ All eras", or "‹ Overview". */
  back: string;
}

export interface EraLanes {
  head: Head1;
  /** The era, when an era is open. */
  era?: PEra;
  lanes: Lane1[];
  /** In a polity or world event, lanes start closed (ticks, and the most prominent named) and one opens to all of it. */
  compact: boolean;
  /** The lane opened to all its entries. */
  open?: Lane1['id'];
  /** Each entry's first lane, a span's row in its lanes, and where the next span in its row starts. */
  laneOf: Map<string, number>;
  rowOf: Map<string, number>;
  nextOf: Map<string, number>;
}

/** Entries by start into the six lanes, in pigment order, then "No lane yet" when anything has none. An entry is in each of its lanes. */
function buildLanes(D: Prepared, ids: Iterable<string>, lanesOf: ReadonlyMap<string, readonly Lane[]>, count: (l: Lane1['id'], n: number) => [number, string]): Pick<EraLanes, 'lanes' | 'laneOf' | 'rowOf' | 'nextOf'> {
  const items = [...new Set(ids)].map((id) => D.byId.get(id)).filter((p): p is PItem => !!p && !p.draft)
    .sort((a, b) => a.s - b.s || b.e - a.e || a.id.localeCompare(b.id));
  const defs = [
    ...LANES.map((d) => ({ id: d as Lane1['id'], label: LANE_LABEL[d], color: `var(--pig-${PIGMENT[d]})` })),
    { id: NO_LANE as Lane1['id'], label: 'No lane yet', color: UMBER },
  ];
  const laneOf = new Map<string, number>(), rowOf = new Map<string, number>(), nextOf = new Map<string, number>();
  const lanes = defs.map((l, li): Lane1 => {
    const mine = items.filter((it) => (lanesOf.get(it.id)?.length ? lanesOf.get(it.id)!.includes(l.id as Lane) : l.id === NO_LANE));
    for (const it of mine) if (!laneOf.has(it.id)) laneOf.set(it.id, li);
    const spans = mine.filter((it) => it.kind !== 'event');
    // Packed into rows by time only, so rows stay put while zooming. An entry in two lanes packs the same in both.
    const rowEnd: number[] = [], rowLast: PItem[] = [];
    for (const it of spans) {
      let r = rowEnd.findIndex((end) => end <= it.s);
      if (r < 0) r = rowEnd.length;
      if (rowLast[r]) nextOf.set(`${l.id}:${rowLast[r].id}`, it.s);
      rowEnd[r] = it.e;
      rowLast[r] = it;
      rowOf.set(`${l.id}:${it.id}`, r);
    }
    const [n, countLabel] = count(l.id, mine.length);
    const ranked = [...mine].sort((a, b) => D.prominence(b.id) - D.prominence(a.id) || a.s - b.s);
    return { ...l, count: n, countLabel, spans, moments: mine.filter((it) => it.kind === 'event'), order: mine, ranked, rows: rowEnd.length };
  });
  // "No lane yet" is last, so leaving it out moves no other lane.
  return { lanes: lanes.filter((l) => l.id !== NO_LANE || l.order.length), laneOf, rowOf, nextOf };
}

/**
 * An era's six lanes. What's in it is what level 0 counts (`eraRegions`): its members and its
 * inner eras' members, plus the inner eras themselves. `lanesOf` is each entry's lanes
 * (`entryLanes`); an entry in several is drawn in each.
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
  const built = buildLanes(D, ids, lanesOf, (l) => {
    const n = l === NO_LANE ? era.noLane : era.mix[l];
    return [n, n ? highlightsN(n) : ''];
  });
  const head: Head1 = { id: era.id, title: era.title, s: era.s, e: era.e, fit: era, when: era.when, sub: highlightsN(era.highlights), opens: era.id, back: '‹ All eras' };
  return { head, era, compact: false, ...built };
}

/**
 * A polity's or world event's six lanes (`pick` as level 0 has it: `pol:<territory>`, or the
 * world event's id), holding `members` (`polityMembers`, `worldMembers`). Each lane starts closed.
 */
export function polityLanes(D: Prepared, pick: string, members: readonly string[], lanesOf: ReadonlyMap<string, readonly Lane[]>): EraLanes | undefined {
  const pol = pick.startsWith('pol:') ? D.polById.get(pick.slice(4)) : undefined;
  const world = pol ? undefined : D.byId.get(pick);
  if (!pol && !world?.world) return undefined;
  const own = pol?.itemId ?? world?.id;
  const built = buildLanes(D, members.filter((id) => id !== own), lanesOf, (_, n) => [n, entriesN(n)]);
  const all = built.lanes.flatMap((l) => l.order);
  const s = pol ? pol.s : world!.s, e = pol ? pol.e : world!.e;
  // Framed on what's in it (and a world event's own years); its life when nothing is.
  const ends = [...all, ...(world ? [world] : [])];
  const lo = ends.length ? Math.min(...ends.map((x) => x.s)) : s, hi = ends.length ? Math.max(...ends.map((x) => x.e)) : e;
  const n = new Set(all.map((x) => x.id)).size;
  const head: Head1 = {
    id: pick, title: pol ? pol.fullTitle : world!.title, s, e, fit: hi - lo < 10 ? { s: lo - 5, e: hi + 5 } : { s: lo, e: hi },
    when: pol ? pol.when : world!.when, sub: `${pol ? '' : 'World event · '}${entriesN(n)}`, opens: own && D.byId.has(own) ? own : undefined, back: '‹ Overview',
  };
  return { head, compact: true, ...built };
}

/** Whether a lane shows all its entries: always in an era, and in a polity once Bob opens it. */
const isOpen = (EL: EraLanes, L: Lane1) => !EL.compact || EL.open === L.id;
/** On a phone a closed lane lists this many, most prominent first. */
const P_CLOSED_LIST = 3;
const LANE_CLOSED = 46;
const P_TICKS = 14;

function laneH(EL: EraLanes, L: Lane1, phone: boolean): number {
  const open = isOpen(EL, L), more = EL.compact && L.order.length > P_CLOSED_LIST;
  if (phone) {
    if (!L.order.length) return P_HEAD + 34;
    if (!open) return P_HEAD + P_TICKS + 6 + Math.min(P_CLOSED_LIST, L.order.length) * P_ITEM + (more ? P_ITEM : 0) + 10;
    return P_HEAD + (L.moments.length ? P_MOMENT : 0) + L.rows * P_ROW + 6 + L.order.length * P_ITEM + (more ? P_ITEM : 0) + 10;
  }
  if (!L.order.length) return LANE1_EMPTY;
  if (!open) return LANE_CLOSED;
  return Math.max(LANE_MIN, PAD1 + (L.moments.length ? MOMENT_ROW : 0) + L.rows * ROW_H + PAD_BOTTOM);
}
const lanesH = (EL: EraLanes, phone: boolean) => EL.lanes.reduce((h, L) => h + laneH(EL, L, phone), 0);

/** How far down the lanes (under the header row) a lane starts, in px. */
export function laneTop(EL: EraLanes, id: Lane1['id'], phone: boolean): number {
  let top = 0;
  for (const L of EL.lanes) { if (L.id === id) break; top += laneH(EL, L, phone); }
  return top;
}

/** How far down the lanes (under the header row) an entry's row is, in px: on a phone, its line in the list. */
export function lane1Span(EL: EraLanes, id: string, phone: boolean): [number, number] | undefined {
  const li = EL.laneOf.get(id);
  if (li === undefined) return undefined;
  const L = EL.lanes[li];
  const top = laneTop(EL, L.id, phone);
  if (!isOpen(EL, L)) return [top, top + laneH(EL, L, phone)];
  if (phone) {
    const y = top + P_HEAD + (L.moments.length ? P_MOMENT : 0) + L.rows * P_ROW + 6 + L.order.findIndex((x) => x.id === id) * P_ITEM;
    return [y, y + P_ITEM];
  }
  const rows = top + PAD1 + (L.moments.length ? MOMENT_ROW : 0);
  const row = EL.rowOf.get(`${L.id}:${id}`);
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

const entriesN = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

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

/** Where what's open sat on level 0, in px from the top of the content: the lanes grow out of it. */
function headSpan(D: Prepared, V: View, EL: EraLanes, phone: boolean): [number, number] | undefined {
  if (EL.era) return eraSpan(D, V, EL.era.id, phone);
  const G = overviewGeo(D, V, phone);
  const id = EL.head.id;
  if (id.startsWith('pol:')) {
    const pid = id.slice(4);
    for (const g of G.bands) for (const sg of g.subs) {
      if (sg.h < 2) continue;
      if (sg.slots.some((x) => x.pol?.id === pid || x.group?.members.some((m) => m.id === pid))) return [sg.y, sg.y + sg.h];
    }
    return undefined;
  }
  const g = G.bands.find((b) => b.B.worlds.some((w) => w.home && w.it.id === id));
  return g ? [g.top, g.top + GOLD_H + HEAD_LINE] : undefined;
}

function eraLevel(c: Ctx, EL: EraLanes) {
  const { D, V, E, S } = c;
  const phone = E.w < PHONE_W;
  const z = V.zoom;
  if (!z || z.t >= 1) { lanes1(c, EL, phone); return; }
  // Opening or closing: the other rows fade while the lanes grow out of the era's band (or the
  // polity's strip), on the same time scale. With reduced motion the lanes only fade in where they'll be.
  const t = z.t;
  const c0: Ctx = { ...c, V: { ...V, scrollY: z.scroll0, hover: undefined, selected: undefined }, S: blank(S) };
  overviewRows(c0);
  for (let i = 0; i < 4; i++) for (const p of c0.S.z[i]) S.z[i].push({ ...p, a: p.a * (1 - t) });
  for (const p of c0.S.gutter) S.gutter.push({ ...p, a: p.a * (1 - t) });
  const c1: Ctx = { ...c, S: blank(S) };
  lanes1(c1, EL, phone);
  const band = headSpan(D, { ...V, scrollY: z.scroll0 }, EL, phone);
  const by = band ? AXIS_H + band[0] - z.scroll0 : AXIS_H, bh = band ? band[1] - band[0] : 60;
  const visH = Math.max(1, Math.min(HEAD1_H + lanesH(EL, phone) - V.scrollY, E.h - AXIS_H));
  const Y = z.fade ? (y: number) => y : (y: number) => { const shut = by + clamp01((y - AXIS_H) / visH) * bh; return shut + (y - shut) * t; };
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
    const h = laneH(EL, L, phone);
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
/** Under a closed lane's name in a polity: what clicking it does. */
const toggleNote = (EL: EraLanes, L: Lane1) => (isOpen(EL, L) ? 'Show fewer' : `Show all ${L.order.length}`);

function lane1(c: Ctx, EL: EraLanes, L: Lane1, top: number, h: number) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const bot = top + h;
  // A faint wash of the lane's pigment over the era's (or polity's) years.
  const wa = Math.max(X(EL.head.s), x0 - 2), wb = Math.min(X(EL.head.e), x1 + 2);
  if (wb > wa) S.z[0].push({ t: 0, k: `qw${L.id}`, a: 1, cls: `tl-lane1 ${L.id}`, x: wa, y: top, w: wb - wa, h, fill: tint(L.color, 7) });
  S.z[0].push({ t: 3, k: `qr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: x1, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  S.gutter.push({ t: 3, k: `qgr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: E.gutter, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  // Its name stays in view while the lane scrolls past.
  const ny = Math.min(Math.max(top + 9, c.top + 9), bot - 36);
  const toggle = EL.compact && L.order.length > 0;
  const hot = toggle && V.hover === LANE_TOGGLE + L.id;
  S.gutter.push({ t: 0, k: `qgs${L.id}`, a: 1, x: 14, y: ny + 2, w: 9, h: 9, r: 1, fill: L.color });
  S.gutter.push({ t: 2, k: `qgn${L.id}`, a: 1, cls: `tl-lane-name${toggle ? ' tl-lane-toggle' : ''}`, x: 30, y: ny + 11, s: fit(M, 'dim', L.label.toUpperCase(), E.gutter - 38), f: 'dim', fill: 'var(--ink)' });
  // In a polity the line under the name says how many and opens the lane: "Show all 12 ▾".
  const count = toggle ? `${toggleNote(EL, L)} ${isOpen(EL, L) ? '▴' : '▾'}` : L.countLabel;
  if (count) S.gutter.push({ t: 2, k: `qgc${L.id}`, a: 1, cls: toggle ? 'tl-lane-toggle' : undefined, id: toggle ? LANE_TOGGLE + L.id : undefined, x: 30, y: ny + 27, s: fit(M, 'dimCount', count, E.gutter - 38), f: 'dimCount', fill: hot ? 'var(--ink)' : 'var(--muted)' });
  if (toggle) S.targets.push({ id: LANE_TOGGLE + L.id, gutter: true, x: 0, y: Math.max(top, c.top), w: E.gutter, h: Math.max(0, Math.min(bot, c.bottom) - Math.max(top, c.top)) });
  if (!L.order.length) {
    S.z[2].push({ t: 2, k: `qe${L.id}`, a: 1, cls: 'tl-lane-empty', x: Math.max(x0, wa) + 16, y: top + h / 2 + 5, s: emptyNote(L), f: 'note', fill: 'var(--muted)' });
    return;
  }
  if (!isOpen(EL, L)) { closedLane(c, L, top, h); return; }
  let rowsTop = top + PAD1;
  if (L.moments.length) { moments1(c, L, rowsTop); rowsTop += MOMENT_ROW; }
  for (const it of L.spans) phase(c, EL, L, it, rowsTop + EL.rowOf.get(`${L.id}:${it.id}`)! * ROW_H);
}

/** How many a closed lane names. */
const CLOSED_NAMES = 5;

/** A closed lane: every entry a faint tick, and up to five of the most prominent named, never overlapping. Clicking it opens it. */
function closedLane(c: Ctx, L: Lane1, top: number, h: number) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  if (top + h < c.top || top > c.bottom) return;
  S.targets.push({ id: LANE_TOGGLE + L.id, x: x0, y: top, w: x1 - x0, h });
  for (const it of L.order) {
    const xa = X(it.s), xb = X(it.e);
    if (xb < x0 - 2 || xa > x1 + 2) continue;
    if (it.kind !== 'event' && xb - xa > 2) {
      const ra = Math.max(xa, x0 - 2);
      S.z[0].push({ t: 0, k: `qk${L.id}${it.id}`, a: 1, x: ra, y: top + h - 9, w: Math.min(xb, x1 + 2) - ra, h: 3, r: 1.5, fill: tint(L.color, 28) });
    }
    if (xa >= x0) S.z[0].push({ t: 3, k: `qt${L.id}${it.id}`, a: 1, cls: 'tl-tick1', x1: xa, y1: top + 5, x2: xa, y2: top + 13, stroke: tint(L.color, 55) });
  }
  // Names sit under the ticks, above the faint spans.
  const cy = top + 25;
  const taken: [number, number][] = [];
  for (const it of L.ranked) {
    if (taken.length >= CLOSED_NAMES) break;
    if (it.e < V.win.start || it.s > V.win.end) continue;
    // A span already under way sticks to the left edge.
    const x = Math.max(X(it.s), x0 + DIAMOND / 2 + 4);
    const lx = x + DIAMOND / 2 + 5;
    const label = fit(M, 'ui', titleOf(it), x1 - 6 - lx);
    if (!label) continue;
    const span: [number, number] = [x - DIAMOND / 2 - 4, lx + M('ui', label) + 10];
    if (taken.some(([a, b]) => span[0] < b && span[1] > a)) continue;
    taken.push(span);
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    const lit = ROLE_STROKE[role.trim()];
    if (hot || lit) S.z[1].push({ t: 1, k: `qnh${L.id}${it.id}`, a: 1, cls: role.trim() || undefined, x, y: cy, r: DIAMOND / 2 + 3, fill: 'var(--panel)', stroke: lit ?? 'var(--ink)', sw: lit ? 2.5 : 1.5 });
    S.z[1].push({ t: 6, k: `qn${L.id}${it.id}`, a: 1, cls: `tl-mark tl-named${sel ? ' selected' : ''}${role}`, id: it.id, x: x - DIAMOND / 2, y: cy - DIAMOND / 2, w: DIAMOND, g: it.approx ? 'diamond-approx' : 'diamond', color: L.color });
    S.z[2].push({ t: 2, k: `qnt${L.id}${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: lx, y: cy + 4, s: label, f: 'ui', fill: hot ? 'var(--ink)' : 'var(--ink-2)' });
    S.boxes.set(it.id, { x: x - DIAMOND / 2, y: cy - DIAMOND / 2, w: DIAMOND, h: DIAMOND });
    S.targets.push({ id: it.id, lane: L.id, x: span[0], y: top + 4, w: Math.max(MIN_HIT, span[1] - span[0]), h: Math.max(MIN_HIT, h - 8) });
  }
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
    if (hot || lit) S.z[1].push({ t: 1, k: `qmh${L.id}${it.id}`, a: 1, cls: role.trim() || undefined, x, y: cy, r: w / 2 + 3, fill: 'var(--panel)', stroke: lit ?? 'var(--ink)', sw: lit ? 2.5 : 1.5 });
    S.z[1].push({ t: 6, k: `qm${L.id}${it.id}`, a: 1, cls: `tl-mark tl-moment${sel ? ' selected' : ''}${role}`, id: it.id, x: x - w / 2, y: cy - w / 2, w, g: it.approx ? 'diamond-approx' : 'diamond', color: L.color });
    S.boxes.set(it.id, { x: x - w / 2, y: cy - w / 2, w, h: w });
    const hx = x - MIN_HIT / 2;
    let hw = MIN_HIT;
    if (x - DIAMOND / 2 - 4 > right) {
      const next = i + 1 < xs.length ? xs[i + 1] - DIAMOND : Infinity;
      const lx = x + DIAMOND / 2 + 5;
      const label = placeLabel(M, 'ui', it.title, Math.min(next, x1 - 4) - lx);
      if (label) {
        S.z[2].push({ t: 2, k: `qmt${L.id}${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: lx, y: cy + 4, s: label, f: 'ui', fill: hot ? 'var(--ink)' : 'var(--ink-2)' });
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
  const k = `${L.id}${it.id}`;
  S.z[1].push({
    t: 0, k: `qb${k}`, a: 1, cls: `tl-mark tl-phase${sel ? ' selected' : ''}${role}`, id: it.id, x: rx, y: by, w: rw, h: bh, r: 2, fill: tint(L.color, hot ? 28 : 16),
    stroke: lit ?? (sel ? 'var(--ink)' : `color-mix(in srgb, ${L.color} 60%, transparent)`), sw: lit ? 2.5 : sel ? 2 : 1, dash: !lit && !sel && (it.approx || it.endApprox),
  });
  S.boxes.set(it.id, { x: rx, y: by, w: rw, h: bh });
  let hx = rx, hw = rw;
  if (hw < MIN_HIT) { hx = rx + rw / 2 - MIN_HIT / 2; hw = MIN_HIT; }
  // Its name: inside, else just after it when there's room before the next in its row, else cut short, else hidden.
  const lw = M('span', it.title);
  const ty = by + bh / 2 + 4.5;
  if (vw >= 3 && lw + 14 <= vw) {
    S.z[2].push({ t: 2, k: `qbt${k}`, a: 1, cls: `tl-label${role}`, id: it.id, x: va + 7, y: ty, s: it.title, f: 'span', fill: 'var(--ink)' });
  } else if (vw >= 3) {
    const next = EL.nextOf.get(`${L.id}:${it.id}`);
    const room = (next === undefined ? Infinity : X(next)) - xb - 12;
    if (lw <= room && xb + 6 + lw <= x1) {
      S.z[2].push({ t: 2, k: `qbt${k}`, a: 1, cls: `tl-label${role} out`, id: it.id, x: xb + 6, y: ty, s: it.title, f: 'span', fill: 'var(--ink-2)' });
      hw = Math.max(hw, xb + 6 + lw - hx);
    } else {
      const s = vw >= MIN_LABEL ? fit(M, 'span', it.title, vw - 14) : '';
      if (s) S.z[2].push({ t: 2, k: `qbt${k}`, a: 1, cls: `tl-label${role}`, id: it.id, x: va + 7, y: ty, s, f: 'span', fill: 'var(--ink)' });
    }
  }
  S.targets.push({ id: it.id, lane: L.id, x: hx, y: rowTop, w: hw, h: ROW_H });
}

/**
 * On a phone: the lane's name, its bars without labels, then a dated list of its spans and moments
 * to tap. A closed lane (in a polity) is its name, a strip of ticks, and its three most prominent.
 */
function phoneLane(c: Ctx, EL: EraLanes, L: Lane1, top: number, h: number) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const open = isOpen(EL, L);
  S.z[0].push({ t: 0, k: `qw${L.id}`, a: 1, cls: `tl-lane1 ${L.id}`, x: x0, y: top, w: x1 - x0, h, fill: tint(L.color, 6) });
  S.z[0].push({ t: 3, k: `qr${L.id}`, a: 1, x1: x0, y1: top + h - 0.5, x2: x1, y2: top + h - 0.5, stroke: 'var(--rule-soft)' });
  S.z[2].push({ t: 0, k: `qgs${L.id}`, a: 1, x: x0 + 12, y: top + 12, w: 9, h: 9, r: 1, fill: L.color });
  const name = L.label.toUpperCase();
  S.z[2].push({ t: 2, k: `qgn${L.id}`, a: 1, cls: 'tl-lane-name', x: x0 + 28, y: top + 21, s: name, f: 'dim', fill: 'var(--ink)' });
  if (L.countLabel) S.z[2].push({ t: 2, k: `qgc${L.id}`, a: 1, x: x0 + 28 + M('dim', name) + 10, y: top + 21, s: L.countLabel, f: 'dimCount', fill: 'var(--muted)' });
  if (EL.compact && L.order.length) S.targets.push({ id: LANE_TOGGLE + L.id, x: x0, y: top, w: x1 - x0, h: P_HEAD });
  if (!L.order.length) {
    S.z[2].push({ t: 2, k: `qe${L.id}`, a: 1, cls: 'tl-lane-empty', x: x0 + 12, y: top + P_HEAD + 18, s: emptyNote(L), f: 'note', fill: 'var(--muted)' });
    return;
  }
  let y = top + P_HEAD;
  let list = L.order;
  if (!open) {
    for (const it of L.order) {
      const x = X(it.s);
      if (x < x0 || x > x1) continue;
      S.z[1].push({ t: 3, k: `qt${L.id}${it.id}`, a: 1, cls: 'tl-tick1', x1: x, y1: y + 2, x2: x, y2: y + P_TICKS - 2, stroke: tint(L.color, 55) });
    }
    y += P_TICKS + 6;
    list = L.ranked.slice(0, P_CLOSED_LIST).sort((a, b) => a.s - b.s);
  } else {
    if (L.moments.length) {
      for (const m of L.moments) {
        const x = X(m.s);
        if (x < x0 - 6 || x > x1 + 6) continue;
        S.z[1].push({ t: 6, k: `qm${L.id}${m.id}`, a: 1, cls: `tl-moment${roleOf(V, m)}`, id: m.id, x: x - 4.5, y: y + P_MOMENT / 2 - 4.5, w: 9, g: m.approx ? 'diamond-approx' : 'diamond', color: L.color });
      }
      y += P_MOMENT;
    }
    for (const it of L.spans) {
      const xa = X(it.s), xb = Math.max(X(it.e), xa + 3);
      if (xb < x0 || xa > x1) continue;
      const rx = Math.max(xa, x0 - 2);
      S.z[1].push({ t: 0, k: `qb${L.id}${it.id}`, a: 1, cls: `tl-phase${roleOf(V, it)}`, id: it.id, x: rx, y: y + EL.rowOf.get(`${L.id}:${it.id}`)! * P_ROW + 2, w: Math.min(xb, x1 + 2) - rx, h: P_ROW - 4, r: 1.5, fill: tint(L.color, 30), stroke: it.approx || it.endApprox ? L.color : undefined, dash: it.approx || it.endApprox });
    }
    y += L.rows * P_ROW + 6;
  }
  list.forEach((it, i) => {
    const ry = y + i * P_ITEM;
    if (ry + P_ITEM < c.top || ry > c.bottom) return;
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    const k = `${L.id}${it.id}`;
    if (hot) S.z[1].push({ t: 0, k: `qlb${k}`, a: 1, x: x0 + 4, y: ry + 1, w: x1 - x0 - 8, h: P_ITEM - 2, r: 4, fill: tint(L.color, sel ? 24 : 12) });
    const years = fit(M, 'tick', it.dates, P_YEAR - 8);
    S.z[2].push({ t: 2, k: `qly${k}`, a: 1, cls: role.trim() || undefined, x: x0 + 12, y: ry + 19, s: years, f: 'tick', fill: 'var(--muted)' });
    // An approximate date is underlined with a dashed umber rule, as edges are dashed elsewhere.
    if (it.approx || it.endApprox) S.z[2].push({ t: 3, k: `qlu${k}`, a: 1, cls: 'tl-approx', x1: x0 + 12, y1: ry + 23, x2: x0 + 12 + M('tick', years), y2: ry + 23, stroke: UMBER, dash: true });
    let tx = x0 + 12 + P_YEAR;
    if (it.kind === 'event') {
      S.z[2].push({ t: 6, k: `qld${k}`, a: 1, cls: role.trim() || undefined, x: tx, y: ry + P_ITEM / 2 - 4.5, w: 9, g: it.approx ? 'diamond-approx' : 'diamond', color: L.color });
      tx += 15;
    }
    S.z[2].push({ t: 2, k: `qlt${k}`, a: 1, cls: `tl-list-item${sel ? ' selected' : ''}${role}`, id: it.id, x: tx, y: ry + 19.5, s: fit(M, 'item', it.title, x1 - 12 - tx), f: 'item', fill: 'var(--ink)' });
    S.boxes.set(it.id, { x: x0 + 4, y: ry + 1, w: x1 - x0 - 8, h: P_ITEM - 2 });
    S.targets.push({ id: it.id, lane: L.id, x: x0, y: ry, w: x1 - x0, h: P_ITEM });
  });
  // "Show all 12" under a closed lane's list, "Show fewer" under an open one's.
  if (EL.compact && L.order.length > P_CLOSED_LIST) {
    const ry = y + list.length * P_ITEM;
    const hot = V.hover === LANE_TOGGLE + L.id;
    S.z[2].push({ t: 2, k: `qls${L.id}`, a: 1, cls: 'tl-lane-toggle', id: LANE_TOGGLE + L.id, x: x0 + 12 + P_YEAR, y: ry + 19.5, s: `${toggleNote(EL, L)} ${open ? '▴' : '▾'}`, f: 'ui', fill: hot ? 'var(--ink)' : 'var(--ink-2)' });
    S.targets.push({ id: LANE_TOGGLE + L.id, x: x0, y: ry, w: x1 - x0, h: P_ITEM });
  }
}

/** The row above the lanes: "‹ All eras" (or "‹ Overview"), then the era's or polity's name (which opens its entry), dates and count. */
function head1(c: Ctx, EL: EraLanes, phone: boolean) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const H = EL.head, y = AXIS_H, h = HEAD1_H, ty = y + 24;
  const back = H.back;
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
    // The name sits at the start, and stays in view while that scrolls off to the left.
    nx = Math.max(X(H.s), x0) + 12;
  }
  const name = fit(M, 'era', H.title, x1 - nx - 12);
  if (!name) return;
  const nw = M('era', name);
  const sel = !!H.opens && V.selected === H.opens, hot = sel || (!!H.opens && V.hover === H.opens);
  S.z[3].push({ t: 2, k: 'qhn', a: 1, cls: `tl-era-head${sel ? ' selected' : ''}`, id: H.opens ?? H.id, x: nx, y: ty, s: name, f: 'era', fill: 'var(--ink)' });
  if (hot) S.z[3].push({ t: 3, k: 'qhu', a: 1, x1: nx, y1: ty + 4, x2: nx + nw, y2: ty + 4, stroke: sel ? 'var(--ink)' : 'var(--ink-2)', sw: sel ? 1.5 : 1 });
  if (H.opens) S.targets.push({ id: H.opens, x: nx - 4, y, w: nw + 8, h });
  const rest = `${H.when} · ${H.sub}`;
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

/** A ring round each picked entry (a cluster's members share one), and the box being drawn. */
function picks(c: Ctx) {
  const { V, S } = c;
  const seen = new Set<Box>();
  for (const id of V.picked ?? []) {
    const b = S.boxes.get(id);
    if (!b || seen.has(b)) continue;
    seen.add(b);
    S.z[3].push({ t: 0, k: `pk${id}`, a: 1, cls: 'tl-picked', id, x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6, r: 5, fill: 'color-mix(in srgb, var(--focus) 12%, transparent)', stroke: 'var(--focus)', sw: 1.5 });
  }
  const r = V.box && norm(V.box);
  if (r) S.z[3].push({ t: 0, k: 'box', a: 1, cls: 'tl-box', x: r.x, y: r.y, w: r.w, h: r.h, fill: 'color-mix(in srgb, var(--focus) 8%, transparent)', stroke: 'var(--focus)', sw: 1, dash: true });
}

/** A box drawn in any direction, with a positive width and height. */
const norm = (b: Box): Box => ({ x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) });

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

/** The entries a box touches (drawn in any direction), inside the plot: not Claude's drafts, and a cluster's members all together. */
export function hitBox(S: Scene, D: Prepared, box: Box): string[] {
  const r = norm(box);
  const x0 = Math.max(r.x, S.plot.x), y0 = Math.max(r.y, S.plot.y);
  const x1 = Math.min(r.x + r.w, S.plot.x + S.plot.w), y1 = Math.min(r.y + r.h, S.plot.y + S.plot.h);
  if (x1 < x0 || y1 < y0) return [];
  const ids: string[] = [];
  for (const [id, b] of S.boxes) {
    const it = D.byId.get(id);
    if (!it || it.draft) continue;
    if (b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0) ids.push(id);
  }
  return ids;
}

/** The lane at a height on screen, for adding an entry where Bob double-clicked. */
export function laneAt(D: Prepared, scrollY: number, y: number): PLane | undefined {
  const cy = y - AXIS_H + scrollY;
  return D.lanes.find((l) => cy >= l.top && cy < l.top + l.height);
}

export type { Prim, Scene, Target, Cluster };
