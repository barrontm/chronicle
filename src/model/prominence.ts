import type { Highlight } from './types';

/**
 * How much Bob has made of each entry, for picking which one leads a cluster on the timeline.
 * A stand-in that counts the highlights behind it; Phase 4 ticket 5 replaces it with
 * `prominence(entry, doc)` (highlights, connections, notes and a landmark star).
 */
export function highlightProminence(highlights: Highlight[]): (id: string) => number {
  const counts = new Map<string, number>();
  for (const h of highlights) for (const id of h.usedBy) counts.set(id, (counts.get(id) ?? 0) + 1);
  return (id) => counts.get(id) ?? 0;
}
