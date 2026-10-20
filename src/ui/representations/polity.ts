import type { Measure, Prim } from '../timeline/scene';
import { F, type Representation } from './types';

/** A solid square at the start of its lifespan bar (split by regime in Phase 5). */
export const polity: Representation = {
  kind: 'polity',
  glyph: `<rect x="4" y="4" width="10" height="10" ${F}/>`,
  point: 'glyph',
  bar: 'bar',
  badge: true,
};

/**
 * A polity on the overview: a strip centred on its row, as thick as its power in each year
 * (docs/design.md, Overview). Filled with its region parent's tone, never a lane's pigment; an
 * approximate start is a dashed umber line; its name sits on it in small caps with a halo.
 */
export interface StripLook {
  /** The years drawn (its life, cut to a little past the window). */
  a: number;
  b: number;
  X: (year: number) => number;
  /** Its row's middle, and the thickest it can be. */
  cy: number;
  T: number;
  /** Its thickness as a share of `T`, in each year. */
  share: (year: number) => number;
  fill: string;
  /** Nothing known of its strength: a faint even strip with a dotted umber edge. */
  unknown: boolean;
  picked: boolean;
  hot: boolean;
  /** Where its start is, in px, when the start is approximate and in view. */
  approxAt?: number;
  /** Its name (and, for a folded group, its members' names after it), and the plot's edges: the name sticks to the left one. */
  name: string;
  sub?: string;
  left: number;
  right: number;
}

/** Below this many px a strip's name is hidden, not cut short. */
const MIN_NAME = 48;

/** The strip's outline: its top edge left to right, then its bottom edge back. */
export function stripPath(L: Pick<StripLook, 'a' | 'b' | 'X' | 'cy' | 'T' | 'share'>): string {
  const xa = L.X(L.a), xb = L.X(L.b);
  const n = Math.min(260, Math.max(2, Math.round((xb - xa) / 5)));
  const top: string[] = [], bot: string[] = [];
  for (let k = 0; k <= n; k++) {
    const y = L.a + ((L.b - L.a) * k) / n, h = (L.share(y) * L.T) / 2, x = L.X(y).toFixed(1);
    top.push(`${x} ${(L.cy - h).toFixed(1)}`);
    bot.push(`${x} ${(L.cy + h).toFixed(1)}`);
  }
  return `M${top.join('L')}L${bot.reverse().join('L')}Z`;
}

const cut = (M: Measure, s: string, room: number) => {
  if (M('pol', s) <= room) return s;
  if (room < MIN_NAME) return '';
  let n = s.length - 1;
  const ell = M('pol', '…');
  while (n > 0 && M('pol', s.slice(0, n)) + ell > room) n--;
  return n > 0 ? `${s.slice(0, n).trimEnd()}…` : '';
};

/** The strip (`marks`) and its name (`text`), keyed by `k`, drawn for `id`. */
export function stripPrims(k: string, id: string, L: StripLook, M: Measure, a = 1): { marks: Prim[]; text: Prim[] } {
  const marks: Prim[] = [], text: Prim[] = [];
  const stroke = L.picked ? 'var(--ink)' : L.hot ? 'var(--ink-2)' : L.unknown ? 'var(--pig-umber)' : undefined;
  marks.push({
    t: 7, k: `ps${k}`, a, cls: `tl-strip${L.picked ? ' picked' : ''}`, id, d: stripPath(L),
    fill: `color-mix(in srgb, ${L.fill} ${L.unknown ? 35 : 88}%, transparent)`, stroke, sw: L.picked ? 2 : 1, dash: !L.picked && !L.hot && L.unknown,
  });
  if (L.approxAt !== undefined) {
    const h = (L.share(L.a) * L.T) / 2;
    marks.push({ t: 3, k: `pa${k}`, a, x1: L.approxAt, y1: L.cy - h, x2: L.approxAt, y2: L.cy + h, stroke: 'var(--pig-umber)', sw: 1.5, dash: true });
  }
  const lx = Math.max(L.X(L.a), L.left + 4) + 5, room = Math.min(L.X(L.b), L.right) - lx - 4;
  const name = cut(M, L.name, room);
  if (name) {
    text.push({ t: 2, k: `pn${k}`, a, cls: 'tl-pol-name', id, x: lx, y: L.cy + 4.5, s: name, f: 'pol', fill: 'var(--ink)' });
    const sx = lx + M('pol', name) + 8;
    if (L.sub && name === L.name && Math.min(L.X(L.b), L.right) - sx > M('polSub', L.sub) + 4) text.push({ t: 2, k: `pm${k}`, a, cls: 'tl-pol-name', id, x: sx, y: L.cy + 4.5, s: L.sub, f: 'polSub', fill: 'var(--ink-2)' });
  }
  return { marks, text };
}
