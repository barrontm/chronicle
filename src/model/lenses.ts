import { ELSEWHERE } from './eras';
import { threadEnds, type ThreadInput } from './threads';
import type { Lane } from './types';

/**
 * Lenses on the overview (docs/design.md, Overview): a thin strip per lane under each region's
 * band, with a tick for each entry in that lane there. An entry is in the regions of its
 * polities, else its outermost era's region (as for threads). Polities' own entries and eras are
 * the strips and washes themselves, so they get no tick.
 */

export interface LensInput extends Pick<ThreadInput, 'polities' | 'polityItems' | 'eras' | 'lanesOf'> {
  /** Every entry's id with its years, in any order. */
  entries: ReadonlyArray<{ id: string; s: number }>;
  /** Each polity's region as the overview has it (by territory id). */
  polityRegions: ReadonlyMap<string, string>;
}

/** Region → lane → the entries in it, earliest first. */
export type LensMarks = Map<string, Map<Lane, string[]>>;

export function lensMarks(o: LensInput): LensMarks {
  const endsOf = threadEnds(o);
  const eraRegion = new Map((o.eras ?? []).map((e) => [e.id, e.region ?? ELSEWHERE]));
  const skip = new Set([...(o.polityItems?.keys() ?? []), ...eraRegion.keys()]);
  const out: LensMarks = new Map();
  for (const it of [...o.entries].sort((a, b) => a.s - b.s || a.id.localeCompare(b.id))) {
    if (skip.has(it.id)) continue;
    const lanes = o.lanesOf.get(it.id);
    if (!lanes?.length) continue;
    const regions = new Set(endsOf(it.id).flatMap((end) => {
      const r = end.startsWith('pol:') ? o.polityRegions.get(end.slice(4)) : eraRegion.get(end);
      return r === undefined ? [] : [r];
    }));
    for (const r of regions) {
      const byLane = out.get(r) ?? out.set(r, new Map()).get(r)!;
      for (const l of lanes) (byLane.get(l) ?? byLane.set(l, []).get(l)!).push(it.id);
    }
  }
  return out;
}
