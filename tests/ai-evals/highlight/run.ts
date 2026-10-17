import { readFileSync } from 'node:fs';
import { draftFromHighlight, PROMPT_ID } from '../../../src/ai/highlight/index';
import { articleSource } from '../../../src/media/article';
import { fetchSubject } from '../../../src/media/wikipedia';
import { makeAnchor, type ArticleText } from '../../../src/model/anchor';
import { parseDoc, upsert } from '../../../src/model/doc';
import { passageCandidates, type WikiLink } from '../../../src/model/passage';
import type { Highlight } from '../../../src/model/types';

/**
 * One highlight case, as the app would run it: Bob highlights `passage` in a
 * recorded article (articles/<key>.json, from scripts/record-article-text.mjs)
 * with the case doc open, the tray looks up the candidates' subjects on
 * Wikidata one at a time, and he asks Claude.
 */
export { PROMPT_ID };
export interface HighlightVars { article: string; passage: string; doc?: string }
interface RecordedArticle extends ArticleText { key: string; title: string; revisionId: number | null; links: WikiLink[] }

const DIR = 'tests/ai-evals/highlight';

export async function runCase(vars: HighlightVars, opts: { apiKey: string; model?: string; today: string; now?: number; fetch?: typeof fetch }) {
  const article: RecordedArticle = JSON.parse(readFileSync(`${DIR}/articles/${vars.article}.json`, 'utf8'));
  const start = article.text.indexOf(vars.passage);
  if (start < 0) throw new Error(`The passage isn’t in ${vars.article}.`);
  const end = start + vars.passage.length;

  let doc = parseDoc(readFileSync(vars.doc ?? `${DIR}/doc.json`, 'utf8'));
  const { source, isNew } = articleSource(doc.sources, article, opts.today);
  if (isNew) doc = upsert(doc, 'sources', source, 1);
  const highlight: Highlight = { id: 'h_case', sourceId: source.id, text: vars.passage, anchor: makeAnchor(article, start, end, article.revisionId ?? undefined)!, usedBy: [], updatedAt: 1 };
  doc = upsert(doc, 'highlights', highlight, 1);

  const candidates = [];
  for (const key of passageCandidates(article.key, article.links, start, end)) {
    candidates.push({ key, subject: await fetchSubject(key).catch(() => undefined) });
  }
  const output = await draftFromHighlight({ highlight, article: { key: article.key, title: article.title, text: article }, candidates, doc, ...opts });
  return { doc, output };
}
