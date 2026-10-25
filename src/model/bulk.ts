import { remove, upsert, type Collection, type RecordOf } from './doc';
import { sortLanes } from './lanes';
import type { Lane, OverviewMark, TimelineDoc, TimelineItem } from './types';

/**
 * Editing or deleting several entries at once (the timeline's box-select), each with one Undo.
 * Every change goes through `upsert` / `remove`.
 */

/** What to set on every entry; a field left out is left alone. */
export interface BulkPatch {
  categoryId?: string;
  /** The lanes to give them all; empty means "sort automatically". */
  lanes?: Lane[];
  /** Only periods have a region (the row they sit in on the overview). */
  region?: string;
  /** null takes them out of the overview. */
  overview?: OverviewMark | null;
}

/** The records a change replaced or removed, as they were, to put back. */
export interface Undo { saved: { collection: Collection; record: RecordOf<Collection> }[] }

/** A period: what the editor gives a region to. */
export const isPeriod = (it: TimelineItem) => (it.subject ? it.subject === 'period' : it.kind === 'span');

function patched(it: TimelineItem, p: BulkPatch): TimelineItem {
  const next: TimelineItem = { ...it };
  if (p.categoryId !== undefined) next.categoryId = p.categoryId;
  if (p.lanes !== undefined) next.lanes = p.lanes.length ? sortLanes(p.lanes) : undefined;
  if (p.region !== undefined && isPeriod(it)) next.region = p.region.trim() || undefined;
  if (p.overview !== undefined) next.overview = p.overview ?? undefined;
  return next;
}

const sameItem = (a: TimelineItem, b: TimelineItem) =>
  a.categoryId === b.categoryId && a.region === b.region && a.overview === b.overview && (a.lanes ?? []).join() === (b.lanes ?? []).join();

/** Set the patch's fields on each entry; one that already has them is left untouched. */
export function bulkEdit(doc: TimelineDoc, ids: readonly string[], patch: BulkPatch, now = Date.now()): { doc: TimelineDoc; undo: Undo; changed: number } {
  const want = new Set(ids);
  let next = doc;
  let changed = 0;
  for (const it of doc.items) {
    if (!want.has(it.id)) continue;
    const p = patched(it, patch);
    if (sameItem(it, p)) continue;
    next = upsert(next, 'items', p, now);
    changed++;
  }
  return { doc: next, undo: undoFor(doc, next), changed };
}

/** Delete the entries, with everything `remove` cleans up after them. */
export function bulkRemove(doc: TimelineDoc, ids: readonly string[], now = Date.now()): { doc: TimelineDoc; undo: Undo; removed: number } {
  let next = doc;
  let removed = 0;
  for (const id of new Set(ids)) {
    if (!next.items.some((i) => i.id === id)) continue;
    next = remove(next, 'items', id, now);
    removed++;
  }
  return { doc: next, undo: undoFor(doc, next), removed };
}

// Regions first, so a record Undo brings back is in place before the entries that name it.
const COLLECTIONS: Collection[] = ['regions', 'items', 'series', 'territories', 'flows', 'notes', 'sources', 'relations', 'highlights', 'groups'];

/** Every record of `before` that `after` replaced or removed. Records are immutable, so a new object means it changed. */
export function undoFor(before: TimelineDoc, after: TimelineDoc): Undo {
  const saved: Undo['saved'] = [];
  for (const c of COLLECTIONS) {
    const kept = new Set((after[c] ?? []) as object[]);
    for (const r of (before[c] ?? []) as RecordOf<Collection>[]) if (!kept.has(r)) saved.push({ collection: c, record: r });
  }
  return { saved };
}

/** Put the saved records back (upsert also lifts their tombstones, so a merge brings them back too). */
export function applyUndo(doc: TimelineDoc, undo: Undo, now = Date.now()): TimelineDoc {
  let next = doc;
  for (const { collection, record } of undo.saved) next = upsert(next, collection, record as never, now);
  return next;
}
