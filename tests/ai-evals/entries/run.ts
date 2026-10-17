import { readFileSync } from 'node:fs';
import { draftEntries, PROMPT_ID } from '../../../src/ai/entries/index';
import { createEmptyDoc, parseDoc } from '../../../src/model/doc';

/** One entries case: Bob's request, on the case doc or an empty timeline. */
export { PROMPT_ID };
export interface EntriesVars { request: string; doc?: string }

export async function runCase(vars: EntriesVars, opts: { apiKey: string; model?: string; today: string; now?: number; fetch?: typeof fetch }) {
  const doc = vars.doc ? parseDoc(readFileSync(vars.doc, 'utf8')) : createEmptyDoc('Eval');
  return { doc, output: await draftEntries({ request: vars.request, doc, ...opts }) };
}
