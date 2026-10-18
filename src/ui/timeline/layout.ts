import { axisTicks, formatRange, formatYear, toDecimalYear } from '../../model/dates';
import type { TimelineItem } from '../../model/types';
import type { YearWindow } from '../timeNav';
import { tint, type Cluster, type MarkKind, type Measure, type Prim, type Scene, type Target } from './scene';

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
/** Moments closer than this many px merge into a cluster. */
export const CLUSTER_PX = 16;
/** Spans narrower than this many px, this close together, merge into a cluster. */
export const TINY_PX = 4;
/** A lane stacks its moments in up to this many rows before they have to share. */
export const MOMENT_ROWS = 3;
const PAD_TOP = 6;
const PAD_BOTTOM = 8;
const LANE_MIN = 44;
/** Labels shorter than this are hidden rather than cut short (docs/design.md, Density). */
const MIN_LABEL = 48;

export interface LaneInput { id: string; label: string; color: string }

export interface PItem {
  id: string;
  kind: MarkKind;
  title: string;
  /** Its dates in words, for the tooltip. */
  when: string;
  s: number;
  e: number;
  approx: boolean;
  endApprox: boolean;
  lane: number;
  /** Spans: the row inside the lane. */
  row: number;
  /** Spans: where the next span in the same row starts (Infinity if none), so a label can sit after this one. */
  nextS: number;
  thumb?: string;
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
}

export function prepare(items: TimelineItem[], lanes: LaneInput[], o: PrepareOptions): Prepared {
  const byId = new Map<string, PItem>();
  const laneIx = new Map(lanes.map((l, i) => [l.id, i]));
  const per: PItem[][] = lanes.map(() => []);
  let lo = Infinity, hi = -Infinity;
  for (const ref of items) {
    const li = laneIx.get(ref.categoryId);
    if (li === undefined) continue;
    const s = toDecimalYear(ref.start);
    // A living person has no end; draw them up to today.
    const e = ref.kind === 'event' ? s : ref.end ? toDecimalYear(ref.end) : o.now;
    const p: PItem = {
      id: ref.id, kind: ref.kind, title: ref.title, when: formatRange(ref.start, ref.end),
      s, e: Math.max(e, s), approx: !!ref.start.approx, endApprox: !!ref.end?.approx,
      lane: li, row: 0, nextS: Infinity, thumb: o.thumbFor?.(ref),
    };
    per[li].push(p);
    byId.set(p.id, p);
    lo = Math.min(lo, p.s);
    hi = Math.max(hi, p.e);
  }
  let top = 0;
  const out = lanes.map((l, li): PLane => {
    const events = per[li].filter((i) => i.kind === 'event').sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
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
    const lane: PLane = { ...l, events, ES: Float64Array.from(events, (e) => e.s), spans, S, PM, spanRows: rowEnd.length, momentRows, top, height };
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

export function layout(D: Prepared, V: View, E: Env, level: Level = 2): Scene {
  void level; // levels 0 and 1 come with their own tickets; everything draws as level 2 until then
  const x0 = E.gutter, x1 = E.w;
  const S: Scene = {
    z: [[], [], []], gutter: [], axis: [], targets: [], clusters: [],
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
    if (cur && x - cur.x < CLUSTER_PX) { cur.members.push(it); cur.last = x; continue; }
    cur = { members: [it], x, last: x, r: 5, lead: it, lw: 0, row: 0, room: Infinity, before: -Infinity };
    marks.push(cur);
  }
  // Each mark takes the first row its dot and label fit in; failing that, the row that frees up
  // soonest, and the label before it there is cut short.
  const rightOf = new Array<number>(L.momentRows).fill(-Infinity);
  const lastIn = new Array<Mark | null>(L.momentRows).fill(null);
  for (const m of marks) {
    if (m.members.length > 1) { m.lead = pickLead(m.members, D.prominence); m.r = badgeR(m.members.length); }
    m.lw = M('ui', m.lead.title);
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
    const label = placeLabel(M, 'ui', it.title, flip ? m.lw : Math.min(m.room, edge));
    const lw = label ? M('ui', label) : 0;
    const lx = flip ? m.x - m.r - 6 : m.x + m.r + 6;
    const anchor = flip ? 'end' as const : undefined;
    const hx = flip ? lx - lw - 4 : m.x - 12;
    const hitW = label ? (flip ? m.x + 12 - hx : lx + lw + 4 - hx) : 24;
    if (m.members.length > 1) {
      const cl: Cluster = { kind: 'event', count: m.members.length, members: m.members.map((x) => x.id), lead: it.id, lane: L.id, s: m.members[0].s, e: m.members[m.members.length - 1].s };
      S.clusters.push(cl);
      const hot = V.hover === `cluster:${it.id}`;
      S.z[1].push({ t: 1, k: `mc${it.id}`, a: 1, cls: 'tl-cluster', x: m.x, y, r: m.r, fill: L.color, stroke: hot ? 'var(--ink)' : 'var(--panel)', sw: hot ? 2 : 1.5 });
      S.z[2].push({ t: 2, k: `mn${it.id}`, a: 1, x: m.x, y: y + 4, s: String(cl.count), f: 'count', fill: 'var(--panel)', anchor: 'middle' });
      if (label) S.z[2].push({ t: 2, k: `mt${it.id}`, a: 1, cls: 'tl-label', x: lx, y: y + 4, s: label, f: 'ui', fill: 'var(--ink-2)', anchor });
      S.targets.push({ id: 'cluster', cluster: cl, lane: L.id, x: hx, y: rowTop, w: hitW, h: ROW_H });
      continue;
    }
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    S.z[1].push({
      t: 1, k: `m${it.id}`, a: 1, cls: `tl-mark${sel ? ' selected' : ''}`, id: it.id, x: m.x, y, r: sel ? 6 : 5,
      fill: it.approx ? 'var(--panel)' : L.color, stroke: hot ? 'var(--ink)' : L.color, sw: sel ? 2 : 1.25, dash: it.approx,
    });
    if (label) S.z[2].push({ t: 2, k: `mt${it.id}`, a: 1, cls: 'tl-label', id: it.id, x: lx, y: y + 4, s: label, f: 'ui', fill: 'var(--ink)', anchor });
    S.targets.push({ id: it.id, lane: L.id, x: hx, y: rowTop, w: hitW, h: ROW_H });
  }
}

/* ---------- spans and lives: bars in their rows; slivers that would overlap become clusters ---------- */

interface Sliver { kind: MarkKind; members: PItem[]; left: number; right: number }

function spans(c: Ctx, L: PLane, rowsTop: number) {
  const { V, S } = c;
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
    if (xb - xa < TINY_PX) {
      const g = pending[it.row];
      if (g && g.kind === it.kind && xa - g.right < TINY_PX) { g.members.push(it); g.right = Math.max(g.right, xb); continue; }
      flush(it.row);
      pending[it.row] = { kind: it.kind, members: [it], left: xa, right: xb };
      continue;
    }
    flush(it.row);
    bar(c, L, it, xa, xb, rowsTop);
  }
  for (let r = 0; r < pending.length; r++) flush(r);
  void S;
}

function bar(c: Ctx, L: PLane, it: PItem, xa: number, xb: number, rowsTop: number) {
  const { V, E, S, x0, x1 } = c;
  const M = E.measure;
  const rowTop = rowsTop + it.row * ROW_H;
  const person = it.kind === 'person';
  const bh = person ? 20 : 22;
  const by = rowTop + (ROW_H - bh) / 2;
  const rx = Math.max(xa, x0 - 4), rr = Math.min(xb, x1 + 4), rw = Math.max(3, rr - rx);
  const va = Math.max(xa, x0), vb = Math.min(xb, x1), vw = vb - va;
  const sel = V.selected === it.id, hot = sel || V.hover === it.id;
  const cls = `tl-mark${sel ? ' selected' : ''}`;
  if (person) {
    S.z[1].push({ t: 0, k: `b${it.id}`, a: 1, cls, id: it.id, x: rx, y: by, w: rw, h: bh, r: bh / 2, fill: hot ? tint(L.color, 12) : 'var(--panel)', stroke: hot ? 'var(--ink)' : tint(L.color, 60), sw: sel ? 2 : 1, dash: it.approx || it.endApprox });
  } else {
    S.z[1].push({ t: 0, k: `b${it.id}`, a: 1, cls, id: it.id, x: rx, y: by, w: rw, h: bh, r: 2, fill: tint(L.color, hot ? 30 : 16), stroke: sel ? 'var(--ink)' : undefined, sw: 2 });
    // The start is a solid edge in the lane's pigment, dashed when it's approximate; so is an approximate end.
    if (xa >= x0 - 3) S.z[1].push({ t: 3, k: `ba${it.id}`, a: 1, x1: xa + 1.5, y1: by, x2: xa + 1.5, y2: by + bh, stroke: L.color, sw: 3, dash: it.approx });
    if (it.endApprox && xb <= x1 + 3) S.z[1].push({ t: 3, k: `bz${it.id}`, a: 1, x1: xb - 1, y1: by, x2: xb - 1, y2: by + bh, stroke: L.color, sw: 2, dash: true });
  }
  // Hit target: the bar, at least 24 px wide, and its label when that sits after it.
  let hx = rx, hw = rw;
  if (hw < MIN_HIT) { hx = rx + rw / 2 - MIN_HIT / 2; hw = MIN_HIT; }
  // Label: inside, else just after if there's room before the next bar in the row, else cut short, else hidden.
  if (vw >= 3) {
    const thumb = it.thumb && vw >= 64 ? it.thumb : undefined;
    const pad = thumb ? 26 : 8;
    const lw = M('span', it.title);
    const ty = by + bh / 2 + 4.5;
    if (thumb) S.z[1].push({ t: 4, k: `bi${it.id}`, a: 1, cls: person ? 'tl-thumb round' : 'tl-thumb', x: va + (person ? 2 : 4), y: by + (bh - 18) / 2, w: 18, h: 18, href: thumb });
    if (lw + pad + 6 <= vw) {
      S.z[2].push({ t: 2, k: `bt${it.id}`, a: 1, cls: 'tl-label', id: it.id, x: va + pad, y: ty, s: it.title, f: 'span', fill: 'var(--ink)' });
    } else {
      const room = (it.nextS === Infinity ? Infinity : c.X(it.nextS)) - xb - 12;
      const after = M('spanI', it.title);
      if (xb + 6 + after <= x1 && after <= room) {
        S.z[2].push({ t: 2, k: `bt${it.id}`, a: 1, cls: 'tl-label', id: it.id, x: xb + 6, y: ty, s: it.title, f: 'spanI', fill: 'var(--ink-2)' });
        hw = Math.max(hw, xb + 6 + after - hx);
      } else {
        const s = vw >= MIN_LABEL ? fit(M, 'span', it.title, vw - pad - 6) : '';
        if (s) S.z[2].push({ t: 2, k: `bt${it.id}`, a: 1, cls: 'tl-label', id: it.id, x: va + pad, y: ty, s, f: 'span', fill: 'var(--ink)' });
      }
    }
  }
  S.targets.push({ id: it.id, lane: L.id, x: hx, y: rowTop, w: hw, h: ROW_H });
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
  S.z[1].push({ t: 0, k: `sc${lead.id}`, a: 1, cls: 'tl-cluster', x: g.left, y: by, w, h: 20, r: g.kind === 'person' ? 10 : 3, fill: L.color, stroke: hot ? 'var(--ink)' : undefined, sw: 2 });
  S.z[2].push({ t: 2, k: `sn${lead.id}`, a: 1, x: g.left + w / 2, y: by + 14, s: n, f: 'count', fill: 'var(--panel)', anchor: 'middle' });
  const last = g.members[g.members.length - 1];
  const room = Math.min(last.nextS === Infinity ? Infinity : c.X(last.nextS) - 12, c.x1 - 4) - (g.left + w) - 6;
  const label = placeLabel(E.measure, 'spanI', lead.title, room);
  let hw = Math.max(w, MIN_HIT);
  if (label) {
    S.z[2].push({ t: 2, k: `st${lead.id}`, a: 1, cls: 'tl-label', x: g.left + w + 6, y: by + 14.5, s: label, f: 'spanI', fill: 'var(--ink-2)' });
    hw = w + 6 + E.measure('spanI', label);
  }
  S.targets.push({ id: 'cluster', cluster: cl, lane: L.id, x: g.left, y: rowTop, w: hw, h: ROW_H });
}

/* ---------- axis, today and the playhead ---------- */

function axis(c: Ctx) {
  const { V, E, S, X, x0, x1 } = c;
  const ts = axisTicks(V.win.start, V.win.end, x1 - x0, 78);
  S.axis.push({ t: 0, k: 'abg', a: 1, x: x0, y: 0, w: x1 - x0, h: AXIS_H, fill: 'var(--panel)' });
  S.axis.push({ t: 3, k: 'arule', a: 1, x1: x0, y1: AXIS_H - 0.5, x2: x1, y2: AXIS_H - 0.5, stroke: 'var(--rule)' });
  for (const t of ts.ticks) {
    const x = X(t.y);
    if (x < x0 - 40 || x > x1 + 40) continue;
    S.z[0].push({ t: 3, k: `g${t.y}`, a: 1, x1: x, y1: AXIS_H, x2: x, y2: E.h, stroke: t.major ? 'var(--rule)' : 'var(--rule-soft)' });
    S.axis.push({ t: 3, k: `ak${t.y}`, a: 1, x1: x, y1: AXIS_H - (t.major ? 7 : 4), x2: x, y2: AXIS_H, stroke: 'var(--ink-2)' });
    // A label that would be cut off at either edge is left out; its tick stays.
    const half = E.measure(t.major ? 'tickB' : 'tick', t.label) / 2;
    if (x - half < x0 || x + half > x1) continue;
    S.axis.push({ t: 2, k: `at${t.y}`, a: 1, cls: 'tl-tick', x, y: ts.heads.length ? 18 : 26, s: t.label, f: t.major ? 'tickB' : 'tick', fill: t.major ? 'var(--ink)' : 'var(--ink-2)', anchor: 'middle' });
  }
  // Month or year headings above day or month ticks, pinned to the left edge while they're in view.
  for (let i = 0; i < ts.heads.length; i++) {
    const h = ts.heads[i];
    const next = i + 1 < ts.heads.length ? X(ts.heads[i + 1].y) : Infinity;
    const x = Math.max(X(h.y), x0) + 4;
    if (next < x0 || x > x1 || next - x < 40) continue;
    S.axis.push({ t: 2, k: `ah${h.y}`, a: 1, x, y: 34, s: h.label, f: 'head', fill: 'var(--muted)' });
  }
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
