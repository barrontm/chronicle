#!/usr/bin/env node
/**
 * Record Wikipedia articles as the reader's text model sees them (cleaned,
 * footnote markers left out, sections and wiki links noted), for the AI test
 * cases of the `highlight` feature. One file per article in
 * tests/ai-evals/highlight/articles/<key>.json.
 *
 *   node scripts/record-article-text.mjs Themistocles            # fetched from Wikipedia
 *   node scripts/record-article-text.mjs Pericles=Pericles.latest.1379806684   # from tests/fixtures/articles
 *
 * Uses the app's own sanitizer and text model (loaded with Vite) under jsdom.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const keys = process.argv.slice(2);
if (!keys.length) {
  console.error('usage: node scripts/record-article-text.mjs <Key>[=<fixture file>] …');
  process.exit(2);
}
const OUT = 'tests/ai-evals/highlight/articles';
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document, DOMParser: window.DOMParser, Node: window.Node, NodeFilter: window.NodeFilter });

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { sanitizeParsoid } = await vite.ssrLoadModule('/src/media/sanitize.ts');
  const { buildArticleUrl } = await vite.ssrLoadModule('/src/media/article.ts');
  const { buildTextModel } = await vite.ssrLoadModule('/src/ui/reader/textModel.ts');
  mkdirSync(OUT, { recursive: true });
  for (const arg of keys) {
    const [key, file] = arg.split('=');
    const raw = file
      ? gunzipSync(readFileSync(`tests/fixtures/articles/${file}.html.gz`)).toString('utf8')
      : await (await fetch(buildArticleUrl(key), { headers: { 'User-Agent': 'Chronicle-tests/0.1 (AI eval articles)' } })).text();
    const s = sanitizeParsoid(raw, { pageTitle: key });
    const root = document.createElement('div');
    root.innerHTML = s.html;
    const m = buildTextModel(root);
    const out = { key, title: s.title || key.replace(/_/g, ' '), revisionId: s.revisionId, text: m.text, sections: m.sections, links: m.links };
    writeFileSync(`${OUT}/${key}.json`, `${JSON.stringify(out)}\n`);
    console.log(`${key}: ${m.text.length} characters, ${m.sections.length} sections, ${m.links.length} links`);
  }
} finally {
  await vite.close();
}
