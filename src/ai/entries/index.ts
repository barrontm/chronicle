import { searchWikipedia } from '../../media/wikipedia';
import type { TimelineDoc } from '../../model/types';
import { DEFAULT_MODEL, draftWithClaude } from '../client';
import { promptBody, promptId, type DraftSet } from '../draft';
import prompt from './prompt.md?raw';
import { searchTool, submitTool, SUBMIT } from './tools';
import { checkProposal } from './validate';
import { toDraft } from './toDraft';

/** Draft timeline entries for a topic Bob describes ("the battles of the Persian Wars"). */
export const FEATURE = 'entries';
export const PROMPT_ID = promptId(FEATURE, prompt);

export interface DraftEntriesArgs {
  request: string;
  doc: TimelineDoc;
  apiKey: string;
  model?: string;
  today: string;
  now?: number;
  signal?: AbortSignal;
  /** Replaces fetch for the Anthropic calls only (tests, recordings). */
  fetch?: typeof fetch;
}

export async function draftEntries(args: DraftEntriesArgs): Promise<DraftSet> {
  const { doc, signal } = args;
  const seenPages = new Map<string, string>();
  const search = searchTool(async (input, sig) => {
    const query = String((input as { query?: unknown })?.query ?? '').trim();
    if (!query) return 'Give a query.';
    const results = await searchWikipedia(query, sig);
    for (const r of results) seenPages.set(r.key, r.title);
    return results.length ? results.map((r) => `${r.key} | ${r.title} | ${r.description ?? ''}`).join('\n') : 'No pages found.';
  });

  const answer = await draftWithClaude({
    apiKey: args.apiKey,
    model: args.model ?? DEFAULT_MODEL,
    system: promptBody(prompt),
    user: userMessage(args.request, doc),
    tools: [search, submitTool(doc.categories)],
    submit: SUBMIT,
    signal,
    fetch: args.fetch,
  });

  const proposal = checkProposal(answer.input, {
    seenPages,
    categoryIds: new Set(doc.categories.map((c) => c.id)),
    existing: new Map(doc.items.map((i) => [i.id, i.title])),
  });
  return toDraft({
    proposal, doc, request: args.request, today: args.today, signal,
    provenance: { model: answer.model, prompt: PROMPT_ID, draftedAt: args.now ?? Date.now() },
  });
}

/** Bob's request, then what's already on his timeline so Claude can skip and connect to it. */
export function userMessage(request: string, doc: TimelineDoc): string {
  const existing = doc.items.slice(0, 400).map((i) => `${i.id} | ${i.title}`).join('\n');
  return `Bob's request: ${request.trim()}\n\nAlready on his timeline (id | title):\n${existing || '(nothing yet)'}`;
}
