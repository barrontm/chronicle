/**
 * Recordings of AI drafting runs: every network response, in order. Unit and
 * e2e tests replay them so check:quiet stays free, offline and repeatable;
 * `npm run eval:ai` makes new ones from live runs.
 */
export interface Exchange { url: string; body: unknown; status?: number }
export interface Recording {
  case: string;
  model: string;
  prompt: string;
  /** True for a recording written by hand before any live run. */
  handmade?: boolean;
  note?: string;
  exchanges: Exchange[];
}

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
export const isAnthropic = (url: string) => url.startsWith(ANTHROPIC);

/**
 * The next recorded response for a URL: Anthropic calls in order, every other
 * URL by exact match (each used once, so repeated lookups replay in order).
 */
export function replayer(rec: Recording): (url: string) => Exchange | undefined {
  const used = new Set<number>();
  return (url) => {
    const i = rec.exchanges.findIndex((e, n) => !used.has(n) && (isAnthropic(url) ? isAnthropic(e.url) : e.url === url));
    if (i < 0) return undefined;
    used.add(i);
    return rec.exchanges[i];
  };
}

/** A fetch that answers from a recording and fails loudly on anything unrecorded. */
export function replayFetch(rec: Recording): typeof fetch {
  const next = replayer(rec);
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const e = next(url);
    if (!e) throw new Error(`No recorded response for ${url}`);
    return new Response(JSON.stringify(e.body), { status: e.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
