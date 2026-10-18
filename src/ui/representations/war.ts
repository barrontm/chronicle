import type { Relation, TimelineItem } from '../../model/types';
import { F, S, type Representation } from './types';

/** A bar with a tick per battle that is part of it. */
export const war: Representation = {
  kind: 'war',
  glyph: `<rect x="1.5" y="6" width="15" height="6" rx="1" ${F} opacity=".35"/><path d="M6 3.5v11M12 3.5v11" ${S} stroke-width="1.8"/>`,
  point: 'glyph',
  bar: 'war',
};

/**
 * The war each battle is a tick on: a battle (a moment) that is `part of` an entry drawn as a
 * war's bar. A battle part of two wars goes on the first one connected.
 */
export function warOf(items: Pick<TimelineItem, 'id' | 'kind' | 'subject'>[], relations: Relation[]): Map<string, string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, string>();
  for (const r of relations) {
    if (r.type !== 'part-of' || out.has(r.fromId)) continue;
    const b = byId.get(r.fromId), w = byId.get(r.toId);
    if (b?.subject === 'battle' && b.kind === 'event' && w?.subject === 'war' && w.kind !== 'event') out.set(b.id, w.id);
  }
  return out;
}
