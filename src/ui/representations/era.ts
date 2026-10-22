import { LANES } from '../../model/types';
import type { Era, EraTheme } from '../../model/eras';
import type { Measure, Prim } from '../timeline/scene';
import { LANE_LABEL, PIGMENT } from '../util';

/**
 * An era on the overview: the backdrop behind its region's polities (docs/design.md, Overview).
 * A wash across the region's band, two tints alternating so neighbours read apart, named in
 * Spectral italic on the band's top line; approximate edges are dashed umber. An inner era (the
 * Fifty Years) is a labelled rule along the band's foot when it's at least 70 px wide.
 */

/** An inner era's rule needs this many px to be drawn. */
const INNER_MIN = 70;

export interface WashLook {
  /** Left and right edges in px, and the plot's edges (its name stays in view while it runs past them). */
  xa: number;
  xb: number;
  x0: number;
  x1: number;
  /** The band's top and bottom. */
  top: number;
  bottom: number;
  /** Where its name's baseline is, and where the region's name ends on that line. */
  nameY: number;
  after: number;
  /** Which of the two tints. */
  alt: boolean;
  selected: boolean;
  /** Extra classes: a connection role, or "dimmed". */
  role: string;
}

/** The wash and its edges (`marks`), and its name (`text`). */
export function washPrims(e: Era, b: WashLook, M: Measure): { marks: Prim[]; text: Prim[] } {
  const marks: Prim[] = [], text: Prim[] = [];
  const rx = Math.max(b.xa, b.x0 - 4), rr = Math.min(b.xb, b.x1 + 4);
  if (rr - rx < 1) return { marks, text };
  const h = b.bottom - b.top;
  const cls = `tl-era${b.selected ? ' selected' : ''}${b.role}`;
  marks.push({ t: 0, k: `e${e.id}`, a: 1, cls, id: e.id, x: rx, y: b.top, w: rr - rx, h, fill: b.alt ? 'var(--band-2)' : 'var(--band)', stroke: b.selected ? 'var(--ink)' : undefined, sw: 2 });
  const role = b.role.trim() || undefined;
  if (b.xa >= b.x0 - 1) marks.push({ t: 3, k: `ea${e.id}`, a: 1, cls: role, x1: b.xa + 0.5, y1: b.top, x2: b.xa + 0.5, y2: b.bottom, stroke: e.approx ? 'var(--pig-umber)' : 'var(--band-edge)', sw: e.approx ? 1.5 : 1, dash: e.approx });
  if (e.endApprox && b.xb <= b.x1 + 1) marks.push({ t: 3, k: `ez${e.id}`, a: 1, cls: role, x1: b.xb - 0.5, y1: b.top, x2: b.xb - 0.5, y2: b.bottom, stroke: 'var(--pig-umber)', sw: 1.5, dash: true });
  // Its name, after the region's, sticking to the left edge while it scrolls past.
  const lx = Math.max(b.xa + 6, b.after);
  if (Math.min(b.xb, b.x1) - lx > M('wash', e.title) + 8) text.push({ t: 2, k: `en${e.id}`, a: 1, cls: `tl-era-name${b.role}`, id: e.id, x: lx, y: b.nameY, s: e.title, f: 'wash', fill: 'var(--ink-2)' });
  return { marks, text };
}

/** An inner era: a rule along the band's foot, named above it when there's room. */
export function innerPrims(e: Era, b: Pick<WashLook, 'xa' | 'xb' | 'x0' | 'x1' | 'bottom' | 'role'>, M: Measure): { marks: Prim[]; text: Prim[] } {
  const marks: Prim[] = [], text: Prim[] = [];
  if (b.xb - b.xa < INNER_MIN) return { marks, text };
  const y = b.bottom - 3;
  const role = b.role.trim() || undefined;
  marks.push({ t: 3, k: `ei${e.id}`, a: 0.7, cls: `tl-era-inner${b.role}`, id: e.id, x1: b.xa + 2, y1: y, x2: b.xb - 2, y2: y, stroke: 'var(--muted)', sw: 1, dash: e.approx || e.endApprox });
  const lx = Math.max(b.xa + 4, b.x0 + 4);
  if (Math.min(b.xb, b.x1) - lx > M('washIn', e.title) + 6) text.push({ t: 2, k: `eit${e.id}`, a: 1, cls: role, id: e.id, x: lx, y: y - 3, s: e.title, f: 'washIn', fill: 'var(--muted)' });
  return { marks, text };
}

/** What an era's tooltip says under its name: its dates and highlights, the biggest lanes first. */
export function bandSummary(e: Era): string {
  if (!e.highlights) return `${e.when} · No highlights yet`;
  const dims = LANES.filter((d) => e.mix[d]).sort((a, b) => e.mix[b] - e.mix[a]).map((d) => `${e.mix[d]} ${LANE_LABEL[d].toLowerCase()}`);
  return `${e.when} · ${e.highlights} ${e.highlights === 1 ? 'highlight' : 'highlights'}${dims.length ? `: ${dims.join(', ')}` : ''}`;
}

/* ---------- theme chips ---------- */

/** A theme chip's id as a target: `theme:<era>:<theme>`. */
export const THEME = 'theme:';
export const themeKey = (era: string, theme: string) => `${THEME}${era}:${theme}`;
export function parseThemeKey(id: string): { era: string; theme: string } | undefined {
  if (!id.startsWith(THEME)) return undefined;
  const [era, theme] = id.slice(THEME.length).split(':');
  return era && theme ? { era, theme } : undefined;
}

/** A chip's height, and a line of chips with the gap under it. */
const CHIP_H = 17;
export const CHIP_LINE = 21;
const SQ = 7;

export interface ChipBox { era: string; theme: EraTheme; label: string; x: number; w: number; line: number }

const countOf = (t: EraTheme) => String(t.highlights);
const chipW = (M: Measure, label: string, t: EraTheme) => 6 + SQ + 5 + M('chip', label) + 5 + M('chipN', countOf(t)) + 6;

/** A narrow era's chips get at least this much room, running on past its end. */
const CHIP_ROOM = 150;

/**
 * Chips packed left to right from `left`, onto a new line whenever the next would run past `right`.
 * None is ever left out: a chip wider than the room has its label cut short.
 */
export function packChips(chips: { era: string; theme: EraTheme }[], left: number, right: number, M: Measure): ChipBox[] {
  const room = Math.max(right - left, CHIP_ROOM);
  const out: ChipBox[] = [];
  let x = left, line = 0;
  for (const c of chips) {
    let label = c.theme.label, w = chipW(M, label, c.theme);
    if (w > room) {
      const bare = chipW(M, '', c.theme);
      while (label.length > 1 && bare + M('chip', `${label}…`) > room) label = label.slice(0, -1);
      label = `${label.trimEnd()}…`;
      w = bare + M('chip', label);
    }
    if (x > left && x + w > left + room) { x = left; line++; }
    out.push({ ...c, label, x, w, line });
    x += w + 4;
  }
  return out;
}

/** How many lines some packed chips take. */
export const chipLines = (boxes: ChipBox[]) => (boxes.length ? Math.max(...boxes.map((b) => b.line)) + 1 : 0);

/**
 * A theme chip (docs/design.md): a square in its main lane's pigment, the label in Spectral and its
 * count. Hovered, its edge takes the pigment; picked, it's washed in it too.
 */
export function chipPrims(b: ChipBox, top: number, o: { hot: boolean; picked: boolean; a?: number; role?: string }): Prim[] {
  const color = `var(--pig-${PIGMENT[b.theme.lane ?? 'none']})`;
  const k = `ch${b.era}:${b.theme.id}`, a = o.a ?? 1, id = themeKey(b.era, b.theme.id);
  const cls = `tl-chip${o.picked ? ' picked' : ''}${o.role ?? ''}`;
  const cy = top + CHIP_H / 2;
  const tx = b.x + 6 + SQ + 5;
  return [
    { t: 0, k, a, cls, id, x: b.x, y: top, w: b.w, h: CHIP_H, r: 3, fill: o.picked ? `color-mix(in srgb, ${color} 14%, var(--panel))` : 'var(--panel)', stroke: o.hot || o.picked ? color : 'var(--rule)', sw: 1 },
    { t: 0, k: `${k}q`, a, x: b.x + 6, y: cy - SQ / 2, w: SQ, h: SQ, r: 1, fill: color },
    { t: 2, k: `${k}t`, a, cls: 'tl-chip-label', id, x: tx, y: cy + 4.2, s: b.label, f: 'chip', fill: 'var(--ink)' },
    { t: 2, k: `${k}n`, a, x: b.x + b.w - 6, y: cy + 3.6, s: countOf(b.theme), f: 'chipN', fill: 'var(--muted)', anchor: 'end' },
  ];
}

/** What a chip's tooltip says. */
export function chipSummary(t: EraTheme): string {
  const n = `${t.highlights} ${t.highlights === 1 ? 'highlight' : 'highlights'}`;
  return t.lane ? `${n}, mostly ${LANE_LABEL[t.lane].toLowerCase()}` : n;
}
