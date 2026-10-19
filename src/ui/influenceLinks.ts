import { describeRelation, influencesOf } from '../model/doc';
import type { Relation } from '../model/types';

/**
 * Lighting up a person's influences on the timeline. Pure, so the class and
 * arrow geometry can be tested without the renderer.
 */

export type InfluenceRole = 'infl-self' | 'infl-by' | 'infl-on' | 'linked';

/** Other connections (caused, part of, responded to, related) touching `id`, each as from → to. */
function otherLinks(relations: Relation[], id: string): Relation[] {
  return relations.filter((r) => r.type !== 'influenced' && r.fromId !== r.toId && (r.fromId === id || r.toId === id));
}

/**
 * Extra class per item when `selectedId` has connections: who influenced it
 * (`infl-by`), whom it influenced (`infl-on`), anything else it's connected to
 * (`linked`), and itself. Everyone else is dimmed. Undefined when there's
 * nothing to light up, so nothing changes.
 */
export function influenceClasses(relations: Relation[], selectedId: string | undefined): Map<string, InfluenceRole> | undefined {
  if (!selectedId) return undefined;
  const { by, on } = influencesOf(relations, selectedId);
  const other = otherLinks(relations, selectedId);
  if (!by.length && !on.length && !other.length) return undefined;
  const roles = new Map<string, InfluenceRole>();
  for (const r of other) roles.set(r.fromId === selectedId ? r.toId : r.fromId, 'linked');
  for (const id of by) roles.set(id, 'infl-by');
  for (const id of on) roles.set(id, 'infl-on');
  roles.set(selectedId, 'infl-self');
  return roles;
}

/** The arrows to draw, each touching the selected item: influencer → influenced, then other connections (from → to). */
export function influenceArrows(relations: Relation[], selectedId: string | undefined): Array<{ fromId: string; toId: string; role: 'infl-by' | 'infl-on' | 'linked' }> {
  if (!selectedId) return [];
  const { by, on } = influencesOf(relations, selectedId);
  return [
    ...by.map((fromId) => ({ fromId, toId: selectedId, role: 'infl-by' as const })),
    ...on.map((toId) => ({ fromId: selectedId, toId, role: 'infl-on' as const })),
    ...otherLinks(relations, selectedId).map((r) => ({ fromId: r.fromId, toId: r.toId, role: 'linked' as const })),
  ];
}

/** Claude's drafted connections, as dashed arrows labelled with how one acted on the other, and a "?". */
export function draftArrows(relations: Relation[]): Array<{ fromId: string; toId: string; role: 'draft'; label: string }> {
  return relations.filter((r) => r.fromId !== r.toId).map((r) => ({
    fromId: r.fromId, toId: r.toId, role: 'draft' as const,
    label: `${r.effect?.trim() || describeRelation(r.type, 'out').toLowerCase()} ?`,
  }));
}

export interface Box { left: number; right: number; top: number; bottom: number }
interface Pt { x: number; y: number }

/** How far before the influenced item's start the arrow leaves the influencer, in pixels. */
const LEAD = 40;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where an arrow leaves the influencer and lands on the influenced. It lands
 * on the start (left end) of the influenced item, and leaves the influencer a
 * little before that moment if it was alive then (else its nearest end), so
 * the arrow reads as "this is when it reached them" and stays visible even
 * between neighbouring rows.
 */
export function anchors(from: Box, to: Box): { a: Pt; b: Pt } {
  const inset = Math.min(8, (from.right - from.left) / 2);
  const midY = (b: Box) => (b.top + b.bottom) / 2;
  const b = { x: to.left, y: midY(to) };
  const ax = clamp(to.left - LEAD, from.left + inset, from.right - inset);
  // Leave from the edge facing the other item, so the line doesn't cross its label.
  const dy = midY(to) - midY(from);
  const ay = Math.abs(dy) < 1 ? midY(from) : dy > 0 ? from.bottom : from.top;
  return { a: { x: ax, y: ay }, b };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A curve's path, and the point halfway along it, where a label can sit. */
export interface Curve { d: string; mid: Pt }

/** A gentle arc from a to b: a quadratic curve bowed to one side of the chord. */
export function arcCurve(a: Pt, b: Pt): Curve {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(60, 12 + len * 0.2);
  // Unit normal to the chord; always bow toward the same side for a consistent look.
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (a.x + b.x) / 2 + nx * bow;
  const cy = (a.y + b.y) / 2 + ny * bow;
  return {
    d: `M${r1(a.x)} ${r1(a.y)} Q${r1(cx)} ${r1(cy)} ${r1(b.x)} ${r1(b.y)}`,
    mid: { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y },
  };
}

/**
 * Two ends at the same year sit one above the other: the arrow loops out to
 * the left and back, so it reads as an arrow rather than a stroke between them.
 */
export function loopCurve(a: Pt, b: Pt): Curve {
  const reach = 26 + Math.abs(b.y - a.y) * 0.25;
  const x = Math.min(a.x, b.x) - reach;
  return {
    d: `M${r1(a.x)} ${r1(a.y)} C${r1(x)} ${r1(a.y)} ${r1(x)} ${r1(b.y)} ${r1(b.x)} ${r1(b.y)}`,
    // A cubic's halfway point: (a + 3c1 + 3c2 + b) / 8.
    mid: { x: (a.x + 6 * x + b.x) / 8, y: (a.y * 4 + b.y * 4) / 8 },
  };
}
