// Live AI test cases for one feature (see the ai-eval skill). Costs money and needs a network,
// so it is never part of check:quiet.
//   ANTHROPIC_API_KEY=… npm run eval:ai -- <feature> [--model <id>] [--case <name>] [--save]
// Runs each case in tests/ai-evals/<feature>/cases.yaml through the app's own code (loaded with
// Vite, so it never drifts from the app), then the built-in checks and the case's asserts.
// Writes report.md and, per case, an import file in out/ that Bob can merge to look at the draft.
// --save updates results.json and the recordings of passing cases, once the report says it's no worse.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'vite';
import { parse } from 'yaml';

const args = process.argv.slice(2);
const feature = args[0];
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
if (!feature || feature.startsWith('--')) {
  console.error('usage: npm run eval:ai -- <feature> [--model <id>] [--case <name>] [--save]');
  process.exit(2);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY first. This calls the live API and costs money.');
  process.exit(2);
}
const dir = `tests/ai-evals/${feature}`;
const cases = parse(readFileSync(`${dir}/cases.yaml`, 'utf8')).tests.filter((t) => !opt('case') || t.description === opt('case'));
const baseline = existsSync(`${dir}/results.json`) ? JSON.parse(readFileSync(`${dir}/results.json`, 'utf8')) : { cases: {} };

// Record every response (Anthropic, Wikipedia, Wikidata) so passing runs can be replayed in tests.
const realFetch = globalThis.fetch;
let exchanges = [];
const recordingFetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const res = await realFetch(input, init);
  const text = await res.clone().text();
  try {
    exchanges.push({ url, status: res.status, body: JSON.parse(text) });
  } catch {
    exchanges.push({ url, status: res.status, body: text });
  }
  return res;
};
globalThis.fetch = recordingFetch;

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const results = [];
try {
  const mod = await vite.ssrLoadModule(`/src/ai/${feature}/index.ts`);
  const { createEmptyDoc, parseDoc, serializeDoc } = await vite.ssrLoadModule('/src/model/doc.ts');
  const { acceptEntry, acceptConnection } = await vite.ssrLoadModule('/src/ai/draft.ts');
  const run = mod.draftEntries;
  for (const c of cases) {
    exchanges = [];
    const started = Date.now();
    const doc = c.vars.doc ? parseDoc(readFileSync(c.vars.doc, 'utf8')) : createEmptyDoc('Eval');
    const checks = [];
    let output;
    try {
      output = await run({ request: c.vars.request, doc, apiKey, model: opt('model'), today: new Date().toISOString().slice(0, 10) });
    } catch (e) {
      checks.push({ metric: 'drafts without an error', pass: false, reason: e.message });
    }
    if (output) {
      // Built-in checks: every record sourced, provenance kept, and the accepted draft still imports.
      checks.push({ metric: 'every entry cites a source', pass: output.entries.every((e) => e.item.citations?.length > 0) });
      checks.push({ metric: 'every record keeps its provenance', pass: [...output.entries.map((e) => e.item), ...output.connections.map((x) => x.relation)].every((r) => r.drafted?.prompt === mod.PROMPT_ID) });
      let merged = doc;
      for (const e of output.entries) if (!e.problems.length) merged = acceptEntry(merged, e);
      for (const x of output.connections) merged = acceptConnection(merged, x);
      let imports = true;
      try { parseDoc(serializeDoc(merged)); } catch (e) { imports = e.message; }
      checks.push({ metric: 'the accepted draft imports', pass: imports === true, reason: imports === true ? undefined : imports });
      for (const a of c.assert ?? []) {
        let pass = false;
        let reason;
        try { pass = !!new Function('output', `return (${a.value});`)(output); } catch (e) { reason = e.message; }
        checks.push({ metric: a.metric ?? a.value, pass, reason });
      }
      mkdirSync(`${dir}/out`, { recursive: true });
      writeFileSync(`${dir}/out/${c.description}.json`, serializeDoc({ ...merged, title: `Draft: ${c.description}`, updatedAt: 0 }));
    }
    const score = checks.filter((x) => x.pass).length / checks.length;
    results.push({ name: c.description, score, checks, output, model: output?.provenance.model ?? opt('model') ?? 'default', ms: Date.now() - started, exchanges });
    console.log(`${score === 1 ? '✓' : '✗'} ${c.description}: ${Math.round(score * 100)}%`);
  }

  const promptId = mod.PROMPT_ID;
  const lines = [`# ${feature}: live eval`, '', `${new Date().toISOString().slice(0, 16)} · prompt ${promptId}`, '', '| Case | Model | Score | Baseline |', '|---|---|---|---|'];
  for (const r of results) {
    const b = baseline.cases[r.name];
    lines.push(`| ${r.name} | ${r.model} | ${Math.round(r.score * 100)}% | ${b ? `${Math.round(b.score * 100)}% (${b.prompt})` : '—'} |`);
  }
  for (const r of results) {
    lines.push('', `## ${r.name}`, '');
    for (const x of r.checks) lines.push(`- ${x.pass ? '✓' : '✗'} ${x.metric}${x.reason ? `: ${x.reason}` : ''}`);
    if (r.output) {
      lines.push('', 'Entries:', ...r.output.entries.map((e) => `- ${e.item.title} (${e.item.start ? JSON.stringify(e.item.start) : 'no date'}${e.item.places?.length ? ', on the map' : ''})${e.problems.length ? ` ⚠ ${e.problems.join('; ')}` : ''}: ${e.why}`));
      if (r.output.connections.length) lines.push('', 'Connections:', ...r.output.connections.map((x) => `- ${x.relation.fromId} ${x.relation.type} ${x.relation.toId}`));
      if (r.output.dropped.length) lines.push('', 'Left out:', ...r.output.dropped.map((d) => `- ${d}`));
    }
  }
  lines.push('', `Drafts to look at: Import → Merge the files in ${dir}/out/.`);
  writeFileSync(`${dir}/report.md`, `${lines.join('\n')}\n`);
  console.log(`Report: ${dir}/report.md`);

  if (args.includes('--save')) {
    const worse = results.filter((r) => baseline.cases[r.name] && r.score < baseline.cases[r.name].score);
    if (worse.length) {
      console.error(`Not saved: worse than the baseline on ${worse.map((r) => r.name).join(', ')}.`);
      process.exit(1);
    }
    mkdirSync(`${dir}/recordings`, { recursive: true });
    for (const r of results) {
      baseline.cases[r.name] = { score: r.score, model: r.model, prompt: promptId, date: new Date().toISOString().slice(0, 10) };
      if (r.score === 1) {
        writeFileSync(`${dir}/recordings/${r.name}.json`, `${JSON.stringify({ case: r.name, model: r.model, prompt: promptId, exchanges: r.exchanges }, null, 2)}\n`);
      }
    }
    writeFileSync(`${dir}/results.json`, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Saved ${dir}/results.json${results.some((r) => r.score === 1) ? ' and recordings of passing cases' : ''}.`);
  }
} finally {
  await vite.close();
  globalThis.fetch = realFetch;
}
