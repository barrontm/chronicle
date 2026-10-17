#!/usr/bin/env node
/**
 * Record what Wikidata says about some Wikipedia articles, for the tests of
 * `src/model/subjects.ts`. One file per article in tests/fixtures/subjects/:
 *   entity   the wbgetentities answer, trimmed to the properties Chronicle reads
 *   parents  P279 ("subclass of") for its classes, four levels up
 *   labels   English labels of the items its facts point at
 *
 *   node scripts/record-subjects.mjs Pericles Battle_of_Salamis …
 *
 * Wikidata rate-limits quickly, so requests go one at a time with a pause.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'Chronicle-tests/0.1 (subject fixtures; https://github.com/)';
const KEEP = ['P31', 'P279', 'P569', 'P570', 'P580', 'P582', 'P585', 'P571', 'P576', 'P625', 'P361', 'P155', 'P156', 'P710', 'P276', 'P122'];
const LINKS = ['P361', 'P155', 'P156', 'P710', 'P276', 'P122'];
const OUT = new URL('../tests/fixtures/subjects/', import.meta.url);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await pause(1500);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    console.warn(`  ${res.status}, waiting`);
    await pause(10000);
  }
  throw new Error(`gave up on ${url}`);
}

const ids = (claims, p) => (claims[p] ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

async function record(key) {
  const title = key.replace(/_/g, ' ');
  const json = await get(`${API}?${new URLSearchParams({ action: 'wbgetentities', sites: 'enwiki', titles: title, props: 'claims|labels', languages: 'en', format: 'json' })}`);
  const [qid, e] = Object.entries(json.entities)[0];
  if (qid.startsWith('-')) throw new Error(`${key}: no Wikidata item`);
  const claims = Object.fromEntries(KEEP.filter((p) => e.claims?.[p]).map((p) => [p, e.claims[p].map((c) => ({
    mainsnak: c.mainsnak, rank: c.rank, ...(c.qualifiers?.P1480 ? { qualifiers: { P1480: c.qualifiers.P1480 } } : {}),
  }))]));
  const entity = { entities: { [qid]: { id: qid, labels: e.labels, claims } } };

  const parents = {};
  let frontier = [...new Set([...ids(claims, 'P31'), ...ids(claims, 'P279')])];
  for (let level = 0; level < 4 && frontier.length; level++) {
    const query = `SELECT ?c ?p WHERE { VALUES ?c { ${frontier.map((q) => `wd:${q}`).join(' ')} } ?c wdt:P279 ?p }`;
    const res = await get(`${SPARQL}?${new URLSearchParams({ query, format: 'json' })}`);
    for (const q of frontier) parents[q] = [];
    for (const b of res.results.bindings) {
      const c = b.c.value.split('/').pop();
      const p = b.p.value.split('/').pop();
      if (!parents[c].includes(p)) parents[c].push(p);
    }
    frontier = [...new Set(Object.values(parents).flat())].filter((q) => !(q in parents));
  }

  const linked = [...new Set(LINKS.flatMap((p) => ids(claims, p)))].slice(0, 50);
  const labels = {};
  if (linked.length) {
    const l = await get(`${API}?${new URLSearchParams({ action: 'wbgetentities', ids: linked.join('|'), props: 'labels', languages: 'en', format: 'json' })}`);
    for (const [id, v] of Object.entries(l.entities)) if (v.labels?.en) labels[id] = v.labels.en.value;
  }

  writeFileSync(new URL(`${key}.json`, OUT), JSON.stringify({ key, title, entity, parents, labels }, null, 1) + '\n');
  console.log(`${key}: ${qid}, ${Object.keys(parents).length} classes, ${Object.keys(labels).length} labels`);
}

mkdirSync(OUT, { recursive: true });
for (const key of process.argv.slice(2)) await record(key);
