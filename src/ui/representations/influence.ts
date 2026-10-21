import type { Box, Measure, Prim, Target } from '../timeline/scene';

/**
 * An influence between lanes (docs/design.md, Influences between lanes): at level 1, an arrow from
 * the cause to what it acted on, in the cause's lane pigment over a halo of the panel colour, with
 * a filled head and the effect in a small pill. Pure: the layout gives each end's box and years.
 */

/** Hit targets on an arrow are this prefix and the connection's id. */
export const ARROW = '__rel:';
/** Arrows sharing a span's end spread along it this many px apart. */
const GAP = 9;
/** Ends this close side by side bow the curve sideways, so it doesn't run down a column of labels. */
const NEAR = 36;
const BOW = 40;
const SW = 1.6, SW_FOCUS = 2.2, HALO = 4.5;
const HEAD_L = 7, HEAD_W = 3.6;
const PILL_H = 15, PILL_PAD = 6;
/** Where along the curve a label tries to sit, in order. */
const LABEL_AT = [0.5, 0.62, 0.38, 0.74, 0.26];
/** Out of focus, an arrow fades to this. */
export const FADED = 0.16;

export interface ArrowEnd {
  id: string;
  /** Where the entry is drawn in that lane. */
  box: Box;
  /** Its years. */
  s: number;
  e: number;
}
export interface ArrowIn {
  /** The connection's id. */
  key: string;
  from: ArrowEnd;
  to: ArrowEnd;
  label: string;
  /** The cause's lane pigment. */
  color: string;
  /** In focus: thicker, and its label always shows. */
  focus?: boolean;
  /** Something else is in focus. */
  faded?: boolean;
}
interface Pt { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (n: number) => Math.round(n * 10) / 10;
const cy = (b: Box) => b.y + b.h / 2;
/** A moment's diamond, rather than a span's bar: its arrows meet at its centre. */
const isPoint = (b: Box) => b.w <= 16;

/** The year the effect landed: the cause's start clamped into the effect's years, then into the cause's. */
export function landYear(cause: { s: number; e: number }, effect: { s: number; e: number }): number {
  return clamp(clamp(cause.s, effect.s, effect.e), cause.s, cause.e);
}

/**
 * Where each arrow leaves and lands: at the year it landed (`X` turns years into px), on the edge
 * facing the other end. Arrows sharing a span's end spread along it, ordered by their other end.
 */
export function attach(arrows: readonly ArrowIn[], X: (y: number) => number): Array<{ a: Pt; b: Pt }> {
  const out = arrows.map((w) => {
    const yr = landYear(w.from, w.to);
    const dy = cy(w.to.box) - cy(w.from.box);
    const edge = (b: Box, down: boolean) => (Math.abs(dy) < 4 ? b.y : down ? b.y + b.h : b.y);
    const x = (b: Box) => (isPoint(b) ? b.x + b.w / 2 : clamp(X(yr), b.x + 2, b.x + b.w - 2));
    return { a: { x: x(w.from.box), y: edge(w.from.box, dy > 0) }, b: { x: x(w.to.box), y: edge(w.to.box, dy < 0) } };
  });
  // Ends on the same edge of the same span, spread GAP apart in the order of their other ends.
  const groups = new Map<string, Array<{ p: Pt; other: Pt; box: Box }>>();
  arrows.forEach((w, i) => {
    for (const [end, p, other] of [[w.from, out[i].a, out[i].b], [w.to, out[i].b, out[i].a]] as const) {
      if (isPoint(end.box)) continue;
      const k = `${end.id}|${end.box.x},${end.box.y}|${p.y}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push({ p, other, box: end.box });
    }
  });
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((m, n) => m.other.x - n.other.x);
    const lo = g[0].box.x + 2, hi = g[0].box.x + g[0].box.w - 2;
    for (let i = 1; i < g.length; i++) g[i].p.x = Math.max(g[i].p.x, g[i - 1].p.x + GAP);
    const over = g[g.length - 1].p.x - hi;
    if (over > 0) for (const m of g) m.p.x -= over;
    for (const m of g) m.p.x = clamp(m.p.x, lo, hi);
  }
  return out;
}

/** A cubic that leaves and enters vertically; side by side it bows sideways, on one row it arches over. */
export function curve(a: Pt, b: Pt): { d: string; at: (t: number) => Pt; c2: Pt } {
  const dy = b.y - a.y;
  let c1: Pt, c2: Pt;
  if (Math.abs(dy) < 4) {
    c1 = { x: a.x, y: a.y - 28 }; c2 = { x: b.x, y: b.y - 28 };
  } else {
    const bow = Math.abs(b.x - a.x) < NEAR ? BOW : 0;
    c1 = { x: a.x + bow, y: a.y + dy * 0.5 }; c2 = { x: b.x + bow, y: b.y - dy * 0.5 };
  }
  const at = (t: number): Pt => {
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    };
  };
  return { d: `M${r1(a.x)} ${r1(a.y)} C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(b.x)} ${r1(b.y)}`, at, c2 };
}

/** A filled head with its tip at `b`, pointing the way the curve arrives (from `from`). */
export function headPath(from: Pt, b: Pt): string {
  const dx = b.x - from.x, dy = b.y - from.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const bx = b.x - ux * HEAD_L, by = b.y - uy * HEAD_L;
  return `M${r1(b.x)} ${r1(b.y)} L${r1(bx - uy * HEAD_W)} ${r1(by + ux * HEAD_W)} L${r1(bx + uy * HEAD_W)} ${r1(by - ux * HEAD_W)} Z`;
}

const overlaps = (p: Box, q: Box) => p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;

/**
 * The arrows' prims: halos, curves and heads (`marks`, under the labels), then each effect's pill
 * (`labels`), and hit targets. A pill sits at the curve's middle if that's free of `taken` (entries'
 * names and marks, and other pills) and inside `within`, else further along; one that would cover something hides until its arrow
 * is in focus. `taken` gains the pills placed.
 */
export function arrowPrims(arrows: readonly ArrowIn[], X: (y: number) => number, M: Measure, taken: Box[], within?: { top: number; bottom: number }): { marks: Prim[]; labels: Prim[]; targets: Target[] } {
  const marks: Prim[] = [], labels: Prim[] = [], targets: Target[] = [];
  const ends = attach(arrows, X);
  // Arrows in focus draw last, so they sit over the faded ones.
  const order = arrows.map((_, i) => i).sort((i, j) => Number(!!arrows[i].focus) - Number(!!arrows[j].focus));
  for (const i of order) {
    const w = arrows[i], { a, b } = ends[i];
    const C = curve(a, b);
    const al = w.faded ? FADED : 1;
    const k = `inf${w.key}`;
    const cls = `tl-influence${w.focus ? ' focus' : ''}${w.faded ? ' faded' : ''}`;
    marks.push({ t: 5, k: `${k}h`, a: al, cls: 'tl-influence-halo', d: C.d, stroke: 'var(--panel)', sw: HALO });
    marks.push({ t: 5, k, a: al, cls, id: ARROW + w.key, d: C.d, stroke: w.color, sw: w.focus ? SW_FOCUS : SW, from: w.from.id, to: w.to.id });
    marks.push({ t: 7, k: `${k}a`, a: al, cls: 'tl-influence-head', d: headPath(C.c2.x === b.x && C.c2.y === b.y ? a : C.c2, b), fill: w.color });
    const pw = M('eff', w.label) + PILL_PAD * 2;
    let pill: Box | undefined;
    for (const t of LABEL_AT) {
      const p = C.at(t), box = { x: p.x - pw / 2, y: p.y - PILL_H / 2, w: pw, h: PILL_H };
      const out = within && (box.y < within.top + 2 || box.y + box.h > within.bottom - 2);
      if (!out && !taken.some((q) => overlaps(box, q))) { pill = box; break; }
    }
    if (!pill && w.focus) { const p = C.at(0.5); pill = { x: p.x - pw / 2, y: p.y - PILL_H / 2, w: pw, h: PILL_H }; }
    if (pill) {
      taken.push(pill);
      labels.push({ t: 0, k: `${k}p`, a: al, cls: `tl-effect${w.focus ? ' focus' : ''}`, x: pill.x, y: pill.y, w: pill.w, h: pill.h, r: PILL_H / 2, fill: 'var(--panel)', stroke: w.color, sw: 1 });
      labels.push({ t: 2, k: `${k}t`, a: al, cls: 'tl-effect-label', id: ARROW + w.key, x: pill.x + pill.w / 2, y: pill.y + 11, s: w.label, f: 'eff', fill: 'var(--ink)', anchor: 'middle' });
      targets.push({ id: ARROW + w.key, x: pill.x - 2, y: pill.y - 3, w: pill.w + 4, h: pill.h + 6 });
    } else {
      // No pill: the curve's middle still answers.
      const p = C.at(0.5);
      targets.push({ id: ARROW + w.key, x: p.x - 8, y: p.y - 8, w: 16, h: 16 });
    }
  }
  return { marks, labels, targets };
}
