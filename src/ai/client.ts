import Anthropic from '@anthropic-ai/sdk';

/**
 * The only importer of @anthropic-ai/sdk (src/ai/CLAUDE.md). It runs one
 * drafting conversation: Claude may call the feature's lookup tools (which run
 * here, on Bob's device) and finishes by calling the feature's submit tool,
 * whose input is returned for the feature's validator. Nothing here touches
 * the doc.
 *
 * Bob's key comes from `ai/key.ts` and goes straight to api.anthropic.com from
 * the browser; there's no server of ours in between.
 */

export const DEFAULT_MODEL = 'claude-opus-5-5';

export type AiProblem = 'offline' | 'no-key' | 'bad-key' | 'busy' | 'refused' | 'no-answer' | 'failed';

export class AiError extends Error {
  constructor(public problem: AiProblem, message: string) {
    super(message);
  }
}

/** A tool Claude can call. `run` is absent for the submit tool, which ends the conversation. */
export interface AiTool {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: false };
  run?: (input: unknown, signal?: AbortSignal) => Promise<string>;
}

export interface DraftRequest {
  apiKey: string;
  model?: string;
  system: string;
  /** Long material that stays the same across requests (an article), sent after the prompt and cached with it. */
  context?: string;
  user: string;
  tools: AiTool[];
  /** Name of the tool whose input is the answer. */
  submit: string;
  /** Lookups allowed before Claude must answer. */
  maxTurns?: number;
  signal?: AbortSignal;
  /** Tests and the eval harness pass their own fetch (to replay or record). */
  fetch?: typeof fetch;
}

export interface DraftAnswer {
  input: unknown;
  model: string;
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export async function draftWithClaude(req: DraftRequest): Promise<DraftAnswer> {
  if (isOffline()) throw new AiError('offline', 'You’re offline. Drafting with AI needs a connection.');
  if (!req.apiKey.trim()) throw new AiError('no-key', 'Add your Anthropic API key first.');
  const model = req.model ?? DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: req.apiKey.trim(),
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(req.fetch ? { fetch: req.fetch } : {}),
  });
  const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { ...t.input_schema, additionalProperties: false },
    strict: true,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: req.user }];
  const maxTurns = req.maxTurns ?? 6;

  for (let turn = 0; turn <= maxTurns; turn++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: [
          { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
          ...(req.context ? [{ type: 'text' as const, text: req.context, cache_control: { type: 'ephemeral' as const } }] : []),
        ],
        tools,
        messages,
        output_config: { effort: 'medium' },
        // If the model declines, the API retries on a fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal: req.signal });
    } catch (e) {
      throw explain(e);
    }
    if (res.stop_reason === 'refusal') throw new AiError('refused', 'Claude declined to draft this. Try describing it differently.');
    if (res.stop_reason === 'max_tokens') throw new AiError('failed', 'The draft was too long. Ask for fewer things at once.');

    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const answer = calls.find((c) => c.name === req.submit);
    if (answer) return { input: answer.input, model: res.model };
    if (!calls.length) throw new AiError('no-answer', 'Claude didn’t propose anything. Try saying it differently.');

    // Append-only history: the whole assistant turn, then every tool result in one user turn.
    messages.push({ role: 'assistant', content: res.content });
    const results: Array<Anthropic.Beta.BetaToolResultBlockParam | Anthropic.Beta.BetaTextBlockParam> = [];
    for (const call of calls) {
      const tool = req.tools.find((t) => t.name === call.name);
      if (!tool?.run) {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: `Unknown tool ${call.name}`, is_error: true });
        continue;
      }
      try {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: await tool.run(call.input, req.signal) });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        results.push({ type: 'tool_result', tool_use_id: call.id, content: `Lookup failed: ${(e as Error).message}`, is_error: true });
      }
    }
    if (turn === maxTurns - 1) {
      results.push({ type: 'text', text: `That was the last lookup. Call ${req.submit} now with what you have.` });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new AiError('no-answer', 'Claude kept looking things up without proposing anything. Try a narrower request.');
}

function explain(e: unknown): Error {
  if (e instanceof Anthropic.APIUserAbortError) {
    const abort = new Error('Stopped');
    abort.name = 'AbortError';
    return abort;
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AiError('bad-key', 'Anthropic didn’t accept your API key. Check it in the key field.');
  }
  if (e instanceof Anthropic.RateLimitError) return new AiError('busy', 'Anthropic says to slow down. Try again in a minute.');
  if (e instanceof Anthropic.InternalServerError) return new AiError('busy', 'Anthropic is busy right now. Try again in a minute.');
  if (e instanceof Anthropic.APIConnectionError) {
    return isOffline() ? new AiError('offline', 'You’re offline. Drafting with AI needs a connection.') : new AiError('failed', 'Couldn’t reach Anthropic. Check your connection and try again.');
  }
  if (e instanceof Anthropic.APIError) return new AiError('failed', `Anthropic returned an error (${e.status ?? '?'}): ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}
