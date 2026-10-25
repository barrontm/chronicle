import { ELSEWHERE } from './eras';

/**
 * Bob's own order of the overview's bands (S8). The automatic order (`orderRegions`) stays the
 * default; a band Bob moved keeps its place (its record's `order`, its index among the bands),
 * and the others order themselves around it. A larger area's bands always sit together, and
 * "Elsewhere" always goes last.
 */

export type ParentOf = (region: string) => string | undefined;

const keyOf = (r: string, parentOf: ParentOf) => parentOf(r) ?? `\u0000${r}`;
const withoutElsewhere = (order: readonly string[]) => order.filter((r) => r !== ELSEWHERE);

/** The bands in runs that share a larger area (a band with none is a run of its own). */
export function bandBlocks(order: readonly string[], parentOf: ParentOf): string[][] {
  const out: string[][] = [];
  let last: string | undefined;
  for (const r of order) {
    const k = keyOf(r, parentOf);
    if (out.length && k === last) out[out.length - 1].push(r);
    else out.push([r]);
    last = k;
  }
  return out;
}

/** The bands in Bob's order: those he moved at their places, the rest in the automatic order around them. */
export function withBobsOrder(auto: readonly string[], orderOf: (r: string) => number | undefined, parentOf: ParentOf): string[] {
  const list = withoutElsewhere(auto), n = list.length;
  const pinOf = (r: string) => { const o = orderOf(r); return o !== undefined && Number.isFinite(o) ? o : undefined; };
  const pinned = list.filter((r) => pinOf(r) !== undefined).sort((a, b) => pinOf(a)! - pinOf(b)! || list.indexOf(a) - list.indexOf(b));
  const slots: (string | undefined)[] = new Array(n).fill(undefined);
  for (const r of pinned) {
    let i = Math.min(n - 1, Math.max(0, Math.round(pinOf(r)!)));
    while (slots[i] !== undefined) i = (i + 1) % n;
    slots[i] = r;
  }
  const rest = list.filter((r) => pinOf(r) === undefined);
  for (let i = 0, k = 0; i < n; i++) if (slots[i] === undefined) slots[i] = rest[k++];
  // A larger area's bands stay together, where its first one is.
  const out: string[] = [], done = new Set<string>();
  for (const r of slots as string[]) {
    const k = keyOf(r, parentOf);
    if (done.has(k)) continue;
    done.add(k);
    out.push(...(slots as string[]).filter((x) => keyOf(x, parentOf) === k));
  }
  return auto.includes(ELSEWHERE) ? [...out, ELSEWHERE] : out;
}

/**
 * A band one place up (-1) or down (1): among its larger area's bands, or, at their edge (or
 * with no larger area), its whole larger area past the next. Nothing when it can't go further.
 */
export function moveBand(order: readonly string[], name: string, dir: -1 | 1, parentOf: ParentOf): { order: string[]; moved: string[] } | undefined {
  if (name === ELSEWHERE) return undefined;
  const blocks = bandBlocks(withoutElsewhere(order), parentOf);
  const bi = blocks.findIndex((b) => b.includes(name));
  if (bi < 0) return undefined;
  const b = blocks[bi], j = b.indexOf(name);
  let moved: string[];
  if (b.length > 1 && j + dir >= 0 && j + dir < b.length) {
    [b[j], b[j + dir]] = [b[j + dir], b[j]];
    moved = [name];
  } else {
    if (bi + dir < 0 || bi + dir >= blocks.length) return undefined;
    [blocks[bi], blocks[bi + dir]] = [blocks[bi + dir], blocks[bi]];
    moved = [...b];
  }
  const out = blocks.flat();
  return { order: order.includes(ELSEWHERE) ? [...out, ELSEWHERE] : out, moved };
}

/**
 * A band (or its larger area's run, `unit`) taken out and put back before the `slot`-th of the
 * others: what a drag shows as it snaps between bands. `slot` counts the bands of its larger
 * area when it moves among them, else the runs.
 */
export function dropBand(order: readonly string[], unit: readonly string[], slot: number, parentOf: ParentOf): string[] {
  const list = withoutElsewhere(order);
  const tail = order.includes(ELSEWHERE) ? [ELSEWHERE] : [];
  if (unit.length === 1) {
    // A band among its larger area's bands, when it has others.
    const b = bandBlocks(list, parentOf).find((x) => x.includes(unit[0]))!;
    if (b.length > 1) {
      const others = b.filter((r) => r !== unit[0]);
      const at = Math.min(others.length, Math.max(0, slot));
      const nb = [...others.slice(0, at), unit[0], ...others.slice(at)];
      return [...bandBlocks(list, parentOf).flatMap((x) => (x === b || x.includes(unit[0]) ? nb : x)), ...tail];
    }
  }
  const blocks = bandBlocks(list, parentOf).filter((x) => !x.includes(unit[0]));
  const at = Math.min(blocks.length, Math.max(0, slot));
  return [...blocks.slice(0, at).flat(), ...bandBlocks(list, parentOf).find((x) => x.includes(unit[0]))!, ...blocks.slice(at).flat(), ...tail];
}

/**
 * What to save after a move: each band's `order` (its index), for the bands Bob has moved
 * before and the ones he just moved, so `withBobsOrder` gives `final` back. When that can't be
 * done with so few, every band keeps its place.
 */
export function bandOrders(final: readonly string[], auto: readonly string[], orderOf: (r: string) => number | undefined, moved: readonly string[], parentOf: ParentOf): Map<string, number> {
  const list = withoutElsewhere(final);
  const pins = new Map(list.flatMap((r, i) => (orderOf(r) !== undefined || moved.includes(r) ? [[r, i] as const] : [])));
  const got = withBobsOrder(auto, (r) => pins.get(r), parentOf);
  if (got.length === final.length && got.every((r, i) => r === final[i])) return pins;
  return new Map(list.map((r, i) => [r, i]));
}
