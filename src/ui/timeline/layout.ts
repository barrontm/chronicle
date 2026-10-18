import { axisTicks, formatRange, formatYear, toDecimalYear } from '../../model/dates';
import type { DatedItem, Relation, TimelineItem } from '../../model/types';
import { anchors, arcCurve, loopCurve, type Box as Edges } from '../influenceLinks';
import { makerOf, markOf, representationOf, warOf, type Representation } from '../representations';
import type { YearWindow } from '../timeNav';
import { tint, type Box, type Cluster, type Link, type MarkKind, type Measure, type Prim, type Scene, type Target } from './scene';

/**
 * The new timeline's layout: pure. `prepare` runs once per data change (lanes, rows, sorted
 * indexes); `layout` runs every frame and returns only what is visible.
 *
 * Level 2 (single entries in category lanes) is the only level so far: levels 0 (era bands)
 * and 1 (an era's six lanes) are Phase 3 tickets 5 and 6.
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
  /** Its dates in words, for the tooltip. */
  when: string;
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

export interface Prepared {
  lanes: PLane[];
  byId: Map<string, PItem>;
  contentH: number;
  prominence: (id: string) => number;
  /** From the earliest start to the latest end, for "Show everything". */
  extent?: YearWindow;
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
  return { lanes: out, byId, contentH: top, prominence: o.prominence ?? (() => 0), extent: lo <= hi ? { start: lo, end: hi } : undefined };
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
  const nearest = (list: PItem[], y: number) => list.reduce<PItem | undefined>((b, it) => (!b || Math.abs(it.s - y) < Math.abs(b.s - y) ? it : b), undefined);
  if (!cur || cur.draft) {
    const mid = (win.start + win.end) / 2;
    return nearest(D.lanes.flatMap((l) => l.order), mid)?.id;
  }
  const L = D.lanes[cur.lane];
  const i = L.order.indexOf(cur);
  switch (key) {
    case 'ArrowLeft': return L.order[Math.max(0, i - 1)].id;
    case 'ArrowRight': return L.order[Math.min(L.order.length - 1, i + 1)].id;
    case 'Home': return L.order[0].id;
    case 'End': return L.order[L.order.length - 1].id;
    default: {
      const dir = key === 'ArrowUp' ? -1 : 1;
      for (let li = cur.lane + dir; li >= 0 && li < D.lanes.length; li += dir) {
        const hit = nearest(D.lanes[li].order, cur.s);
        if (hit) return hit.id;
      }
      return cur.id;
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
}

export interface Env {
  w: number;
  h: number;
  /** Width of the lane names on the left. */
  gutter: number;
  measure: Measure;
}

interface Ctx { D: Prepared; V: View; E: Env; S: Scene; X: (y: number) => number; x0: number; x1: number; top: number; bottom: number }

/** How far the lanes can scroll. */
export function maxScroll(D: Prepared, h: number): number {
  return Math.max(0, D.contentH - (h - AXIS_H) + 8);
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
  void level; // levels 0 and 1 come with their own tickets; everything draws as level 2 until then
  const x0 = E.gutter, x1 = E.w;
  const S: Scene = {
    z: [[], [], [], []], gutter: [], axis: [], targets: [], clusters: [], boxes: new Map(),
    plot: { x: x0, y: AXIS_H, w: Math.max(0, x1 - x0), h: Math.max(0, E.h - AXIS_H) },
    gutterBox: { x: 0, y: AXIS_H, w: x0, h: Math.max(0, E.h - AXIS_H) },
    contentH: D.contentH,
  };
  const span = V.win.end - V.win.start;
  const ppy = (x1 - x0) / span;
  const X = (y: number) => x0 + (y - V.win.start) * ppy;
  const c: Ctx = { D, V, E, S, X, x0, x1, top: AXIS_H, bottom: E.h };

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
  axis(c);
  return S;
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

function arrows(c: Ctx) {
  const { V, S } = c;
  for (const l of V.links ?? []) {
    const from = S.boxes.get(l.fromId) ?? offscreen(c, l.fromId), to = S.boxes.get(l.toId) ?? offscreen(c, l.toId);
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

function axis(c: Ctx) {
  const { V, E, S, X, x0, x1 } = c;
  const ts = axisTicks(V.win.start, V.win.end, x1 - x0, 78);
  S.axis.unshift({ t: 0, k: 'abg', a: 1, x: x0, y: 0, w: x1 - x0, h: AXIS_H, fill: 'var(--panel)' }, { t: 3, k: 'arule', a: 1, x1: x0, y1: AXIS_H - 0.5, x2: x1, y2: AXIS_H - 0.5, stroke: 'var(--rule)' });
  const ax: Prim[] = [];
  for (const t of ts.ticks) {
    const x = X(t.y);
    if (x < x0 - 40 || x > x1 + 40) continue;
    S.z[0].push({ t: 3, k: `g${t.y}`, a: 1, x1: x, y1: AXIS_H, x2: x, y2: E.h, stroke: t.major ? 'var(--rule)' : 'var(--rule-soft)' });
    ax.push({ t: 3, k: `ak${t.y}`, a: 1, x1: x, y1: AXIS_H - (t.major ? 7 : 4), x2: x, y2: AXIS_H, stroke: 'var(--ink-2)' });
    // A label that would be cut off at either edge is left out; its tick stays.
    const half = E.measure(t.major ? 'tickB' : 'tick', t.label) / 2;
    if (x - half < x0 || x + half > x1) continue;
    ax.push({ t: 2, k: `at${t.y}`, a: 1, cls: 'tl-tick', x, y: ts.heads.length ? 18 : 26, s: t.label, f: t.major ? 'tickB' : 'tick', fill: t.major ? 'var(--ink)' : 'var(--ink-2)', anchor: 'middle' });
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
  if (x < S.plot.x) return undefined;
  for (let i = S.targets.length - 1; i >= 0; i--) {
    const t = S.targets[i];
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
