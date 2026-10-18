import { DIMENSIONS } from '../../model/types';
import type { Era } from '../../model/eras';
import type { Measure, Prim } from '../timeline/scene';
import { DIMENSION_LABEL, PIGMENT } from '../util';

/**
 * An era at level 0: a band (docs/design.md, Overview: A · Bands). Its name in spaced small caps,
 * its dates, a row of landmarks (its most prominent entries as their glyphs), and a strip along
 * the bottom with the mix of dimensions in its highlights. Approximate ends are dashed umber
 * edges. Theme chips (Phase 4) go between the dates and the landmarks, and make the band taller.
 */

/** Band height, and where its parts sit from its top. */
export const BAND_H = 68;
const NAME_Y = 21;
const DATES_Y = 37;
/** The landmark row's middle. */
export const LANDMARK_Y = 51;
export const LANDMARK = 14;
const MIX_H = 5;
/** Below this many px a band shows no text. */
const MIN_TEXT = 36;

export interface BandLook {
  /** Left and right edges in px, and the plot's edges (text stays in view while the band runs past them). */
  xa: number;
  xb: number;
  x0: number;
  x1: number;
  y: number;
  hot: boolean;
  selected: boolean;
  /** Extra classes: a connection role, or "dimmed". */
  role: string;
}

/** Text cut short with an ellipsis to fit, or '' when nothing fits. */
function fit(M: Measure, font: 'era', s: string, avail: number): string {
  if (M(font, s) <= avail) return s;
  const ell = M(font, '…');
  let n = s.length - 1;
  while (n > 0 && M(font, s.slice(0, n)) + ell > avail) n--;
  return n > 0 ? `${s.slice(0, n).trimEnd()}…` : '';
}

/** The band's primitives: its block and edges (`marks`) and its words (`text`). */
export function bandPrims(e: Era, b: BandLook, M: Measure): { marks: Prim[]; text: Prim[] } {
  const marks: Prim[] = [], text: Prim[] = [];
  const rx = Math.max(b.xa, b.x0 - 4), rr = Math.min(b.xb, b.x1 + 4), rw = Math.max(3, rr - rx);
  const va = Math.max(b.xa, b.x0), vb = Math.min(b.xb, b.x1);
  const cls = `tl-era${b.selected ? ' selected' : ''}${b.role}`;
  marks.push({
    t: 0, k: `e${e.id}`, a: 1, cls, id: e.id, x: rx + 1.5, y: b.y, w: Math.max(0, rw - 3), h: BAND_H, r: 3, fill: 'var(--panel)',
    stroke: b.selected ? 'var(--ink)' : b.hot ? 'var(--ink-2)' : 'var(--band-edge)', sw: b.selected ? 2 : 1,
  });
  // The mix of dimensions along the bottom, in pigment order, over the whole band so it stays put while panning.
  const total = DIMENSIONS.reduce((n, d) => n + e.mix[d], 0);
  let at = b.xa + 1.5;
  const full = Math.max(0, b.xb - b.xa - 3);
  for (const d of DIMENSIONS) {
    if (!e.mix[d] || !total) continue;
    const w = (full * e.mix[d]) / total;
    const sa = Math.max(at, b.x0 - 4), sb = Math.min(at + w, b.x1 + 4);
    if (sb > sa) marks.push({ t: 0, k: `em${d}${e.id}`, a: 1, cls: `tl-era-mix ${d}${b.role}`, id: e.id, x: sa, y: b.y + BAND_H - MIX_H, w: sb - sa, h: MIX_H, fill: `var(--pig-${PIGMENT[d]})` });
    at += w;
  }
  // Approximate ends: dashed umber edges over the band's own.
  if (e.approx && b.xa >= b.x0 - 3) marks.push({ t: 3, k: `ea${e.id}`, a: 1, cls: b.role.trim() || undefined, x1: b.xa + 1.5, y1: b.y, x2: b.xa + 1.5, y2: b.y + BAND_H, stroke: 'var(--pig-umber)', sw: 2, dash: true });
  if (e.endApprox && b.xb <= b.x1 + 3) marks.push({ t: 3, k: `ez${e.id}`, a: 1, cls: b.role.trim() || undefined, x1: b.xb - 1.5, y1: b.y, x2: b.xb - 1.5, y2: b.y + BAND_H, stroke: 'var(--pig-umber)', sw: 2, dash: true });
  const room = vb - va - 18;
  if (vb - va < MIN_TEXT) return { marks, text };
  const name = fit(M, 'era', e.title, room);
  if (name) text.push({ t: 2, k: `en${e.id}`, a: 1, cls: `tl-era-name${b.role}`, id: e.id, x: va + 9, y: b.y + NAME_Y, s: name, f: 'era', fill: 'var(--ink)' });
  if (M('eraDates', e.when) <= room) text.push({ t: 2, k: `ed${e.id}`, a: 1, cls: `tl-era-dates${b.role}`, x: va + 9, y: b.y + DATES_Y, s: e.when, f: 'eraDates', fill: 'var(--muted)' });
  return { marks, text };
}

/** What the band's tooltip says under its name: its dates and highlights, the biggest dimensions first. */
export function bandSummary(e: Era): string {
  if (!e.highlights) return `${e.when} · No highlights yet`;
  const dims = DIMENSIONS.filter((d) => e.mix[d]).sort((a, b) => e.mix[b] - e.mix[a]).map((d) => `${e.mix[d]} ${DIMENSION_LABEL[d].toLowerCase()}`);
  return `${e.when} · ${e.highlights} ${e.highlights === 1 ? 'highlight' : 'highlights'}${dims.length ? `: ${dims.join(', ')}` : ''}`;
}
