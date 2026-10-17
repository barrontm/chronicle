import type { ArticleText } from '../../model/anchor';
import { formatRange } from '../../model/dates';
import { KIND_LABEL, findInChronicle, linkedIds, subjectPartOf, subjectWhen, type Subject } from '../../model/subjects';
import type { Highlight, TimelineDoc, TimelineItem } from '../../model/types';
import { DEFAULT_MODEL, draftWithClaude } from '../client';
import { promptBody, promptId, type DraftSet } from '../draft';
import prompt from './prompt.md?raw';
import { submitTool, SUBMIT } from './tools';
import { checkHighlightAnswer, normalize, scopeOf, type Scope } from './validate';
import { toDraft } from './toDraft';

/** Draft records from a passage Bob highlighted: a dimension, entries for what has no article, connections with an effect. */
export const FEATURE = 'highlight';
export const PROMPT_ID = promptId(FEATURE, prompt);

/** A page the highlight could be about: the article's own first, then the pages the passage links (`passageCandidates`). */
export interface Candidate { key: string; subject?: Subject }

export interface DraftFromHighlightArgs {
  highlight: Highlight;
  article: { key: string; title: string; text: ArticleText };
  candidates: Candidate[];
  doc: TimelineDoc;
  apiKey: string;
  model?: string;
  today: string;
  now?: number;
  signal?: AbortSignal;
  /** Replaces fetch for the Anthropic calls only (tests, recordings). */
  fetch?: typeof fetch;
}

export async function draftFromHighlight(args: DraftFromHighlightArgs): Promise<DraftSet> {
  const { highlight, article, candidates, doc, signal } = args;
  const scope = scopeOf(article.text, highlight);
  const matching = matchingEntries(doc, candidates, scope);

  const answer = await draftWithClaude({
    apiKey: args.apiKey,
    model: args.model ?? DEFAULT_MODEL,
    system: promptBody(prompt),
    context: articleBlock(article.title, article.text),
    user: userMessage(highlight, candidates, matching, doc),
    tools: [submitTool(doc.categories)],
    submit: SUBMIT,
    maxTurns: 1,
    signal,
    fetch: args.fetch,
  });

  const checked = checkHighlightAnswer(answer.input, {
    scope,
    existing: new Map(matching.map((i) => [i.id, i.title])),
    candidates: new Map(candidates.map((c) => [c.key, c.subject?.label ?? c.key.replace(/_/g, ' ')])),
    categoryIds: new Set(doc.categories.map((c) => c.id)),
  });
  return toDraft({
    checked, highlight, doc, today: args.today, signal,
    candidates: new Map(candidates.map((c) => [c.key, c.subject])),
    provenance: { model: answer.model, prompt: PROMPT_ID, draftedAt: args.now ?? Date.now() },
  });
}

/** The article as one cached block: the same for every highlight Bob asks about in it. */
export function articleBlock(title: string, text: ArticleText): string {
  return `The article Bob is reading: “${title}” (English Wikipedia). Each section starts with its heading on a line of its own.\n\n${text.text}`;
}

/**
 * Bob's entries the passage may be about: the candidates' own entries and the
 * ones their Wikidata facts name, then any whose title the highlight or its
 * section mentions. At most `max`, in that order.
 */
export function matchingEntries(doc: Pick<TimelineDoc, 'items'>, candidates: Candidate[], scope: Scope, max = 40): TimelineItem[] {
  const qids = new Set(candidates.flatMap((c) => (c.subject ? [c.subject.qid, ...linkedIds(c.subject.facts)] : [])));
  const text = normalize(`${scope.highlight}\n${scope.section}`);
  const byQid = doc.items.filter((i) => i.wikidataId && qids.has(i.wikidataId));
  const byName = doc.items.filter((i) => !byQid.includes(i) && i.title.length > 3 && text.includes(normalize(i.title)));
  return [...byQid, ...byName].slice(0, max);
}

const when = (i: TimelineItem) => formatRange(i.start, i.end);

/** The highlight and its section, what its pages are about, and what Bob already has. */
export function userMessage(h: Highlight, candidates: Candidate[], matching: TimelineItem[], doc: Pick<TimelineDoc, 'items'>): string {
  const pages = candidates.map((c, n) => {
    const s = c.subject;
    const have = s && findInChronicle(doc.items, s.qid);
    const facts = s ? [s.kind && KIND_LABEL[s.kind], subjectWhen(s), subjectPartOf(s) && `part of ${subjectPartOf(s)}`].filter(Boolean).join(' · ') : 'not on Wikidata';
    return `${c.key} | ${s?.label ?? c.key.replace(/_/g, ' ')} | ${facts}${have ? ` | Bob has it: ${have.id}` : ''}${n === 0 ? ' | the article’s own subject' : ''}`;
  });
  const entries = matching.map((i) => `${i.id} | ${i.title} | ${when(i)}${i.wikidataId ? ` | ${i.wikidataId}` : ''}`);
  return [
    `Bob highlighted this passage, in the section “${h.anchor?.section || 'the lead'}”:`,
    `<highlight>${h.text}</highlight>`,
    '',
    'Pages it could be about (key | title | what Wikidata says):',
    ...pages,
    '',
    'His entries that may be involved (id | title | dates | Wikidata id):',
    ...(entries.length ? entries : ['(none)']),
  ].join('\n');
}
