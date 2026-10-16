import { RELATION_TYPES } from '../../model/doc';
import type { RelationType } from '../../model/types';

/**
 * Checks Claude's proposal before anything is fetched or shown. Pure, so the
 * rules are unit-tested. Anything left out is explained in `dropped`, in Bob's
 * words, so he can see what the draft didn't include and why.
 */

export interface ProposedEntry { page: string; categoryId: string; why: string }
export interface ProposedConnection { from: string; to: string; type: RelationType }

export interface CheckedProposal {
  entries: ProposedEntry[];
  connections: ProposedConnection[];
  dropped: string[];
}

export interface ProposalContext {
  /** Page key → title for every page search_wikipedia returned in this conversation. */
  seenPages: Map<string, string>;
  categoryIds: Set<string>;
  /** Ids (and titles, for messages) of entries already on the timeline. */
  existing: Map<string, string>;
  maxEntries?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function checkProposal(input: unknown, ctx: ProposalContext): CheckedProposal {
  const dropped: string[] = [];
  if (!isObj(input) || !Array.isArray(input.entries)) return { entries: [], connections: [], dropped: ['Claude’s answer wasn’t in the expected shape.'] };
  const max = ctx.maxEntries ?? 25;
  const entries: ProposedEntry[] = [];
  const seen = new Set<string>();
  for (const raw of input.entries) {
    if (!isObj(raw)) continue;
    const page = str(raw.page).replace(/ /g, '_');
    if (!page || seen.has(page)) continue;
    if (!ctx.seenPages.has(page)) {
      dropped.push(`“${page.replace(/_/g, ' ')}”: not a page Claude found by searching, so it may not exist.`);
      continue;
    }
    if (entries.length >= max) {
      dropped.push(`“${ctx.seenPages.get(page)}”: more than ${max} entries at once.`);
      continue;
    }
    seen.add(page);
    const cat = str(raw.category);
    entries.push({ page, categoryId: ctx.categoryIds.has(cat) ? cat : [...ctx.categoryIds][0] ?? cat, why: str(raw.why) });
  }

  const connections: ProposedConnection[] = [];
  const keys = new Set<string>();
  const nameOf = (end: string) => ctx.seenPages.get(end) ?? ctx.existing.get(end) ?? end.replace(/_/g, ' ');
  for (const raw of Array.isArray(input.connections) ? input.connections : []) {
    if (!isObj(raw)) continue;
    const from = endOf(str(raw.from), seen, ctx);
    const to = endOf(str(raw.to), seen, ctx);
    const type = str(raw.type) as RelationType;
    if (!from || !to) {
      dropped.push(`A connection from “${nameOf(str(raw.from))}” to “${nameOf(str(raw.to))}”: one end isn’t in the draft or on your timeline.`);
      continue;
    }
    if (from === to || !RELATION_TYPES.includes(type)) continue;
    if (ctx.existing.has(from) && ctx.existing.has(to)) continue; // only connections that involve something new
    const key = `${from}|${to}|${type}`;
    if (keys.has(key)) continue;
    keys.add(key);
    connections.push({ from, to, type });
  }
  return { entries, connections, dropped };
}

/** A connection end is a proposed page (spaces or underscores) or an existing entry id. */
function endOf(end: string, proposed: Set<string>, ctx: ProposalContext): string | undefined {
  if (ctx.existing.has(end)) return end;
  const page = end.replace(/ /g, '_');
  return proposed.has(page) ? page : undefined;
}
