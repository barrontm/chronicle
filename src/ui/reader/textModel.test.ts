// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findAnchor, makeAnchor } from '../../model/anchor';
import { sanitizeParsoid } from '../../media/sanitize';
import { buildTextModel, indicesOf, rangeOf, type TextModel } from './textModel';

function modelOf(html: string): TextModel {
  const root = document.createElement('div');
  root.innerHTML = html;
  return buildTextModel(root);
}

/** A cleaned article from the recorded Parsoid HTML in tests/fixtures/articles. */
function recorded(file: string) {
  const raw = gunzipSync(readFileSync(resolve('tests/fixtures/articles', `${file}.html.gz`))).toString('utf8');
  const s = sanitizeParsoid(raw);
  return { model: modelOf(s.html), revisionId: s.revisionId ?? 0 };
}

describe('buildTextModel', () => {
  it('collapses whitespace, breaks between blocks and leaves out footnote markers', () => {
    const m = modelOf('<p>Pericles   led <b>Athens</b>.<sup class="fn"><a href="#n1">1</a></sup> He died.</p><p>Next</p>');
    expect(m.text).toBe('Pericles led Athens. He died.\nNext\n');
  });

  it('starts a section at each heading, named by its text', () => {
    const m = modelOf('<section><p>Lead.</p></section><section><h2>Early  life</h2><p>Born.</p></section>');
    expect(m.sections.map((s) => s.title)).toEqual(['', 'Early life']);
    expect(m.text.slice(m.sections[1].start, m.sections[1].end)).toBe('Early life\nBorn.\n');
  });

  it('turns DOM ranges into text spans and back, across inline elements', () => {
    const m = modelOf('<p>The war of <a href="#">Athens</a> and Sparta.</p>');
    const s = m.text.indexOf('of Athens and');
    const r = rangeOf(m, s, s + 'of Athens and'.length);
    expect(r.toString()).toBe('of Athens and');
    expect(indicesOf(m, r)).toEqual([s, s + 'of Athens and'.length]);
  });

  it('gives no span for a range without article text', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Text</p><p> </p>';
    const m = buildTextModel(root);
    const r = document.createRange();
    r.selectNodeContents(root.childNodes[1]);
    expect(indicesOf(m, r)).toBeNull();
  });
});

// Highlights made on an older revision, found again in a later one: the spike's test, on recorded pages.
describe('re-anchoring across a revision', () => {
  function sample(m: TextModel, n: number, seed: number): [number, number][] {
    let x = seed;
    const rand = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const out: [number, number][] = [];
    while (out.length < n) {
      let s = Math.floor(rand() * m.text.length);
      while (s > 0 && !/[\s]/.test(m.text[s - 1])) s--;
      let e = s + 20 + Math.floor(rand() * 180);
      const nl = m.text.indexOf('\n', s);
      if (nl >= 0 && nl < e) e = nl;
      while (e < m.text.length && /\w/.test(m.text[e])) e++;
      if (e - s >= 15) out.push([s, e]);
    }
    return out;
  }

  const cases = [
    { name: 'Peloponnesian War, six months apart', from: 'Peloponnesian_War.6m.1336081717', to: 'Peloponnesian_War', placed: 0.95 },
    { name: 'Pericles, two years apart', from: 'Pericles.2y.1248645038', to: 'Pericles.latest.1379806684', placed: 0.85 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const before = recorded(c.from);
      const after = recorded(c.to);
      expect(after.revisionId).toBeGreaterThan(before.revisionId);
      const anchors = sample(before.model, 200, 42).map(([s, e]) => makeAnchor(before.model, s, e, before.revisionId)!);
      const found = anchors.map((a) => findAnchor(after.model, a));
      expect(found.filter(Boolean).length / anchors.length).toBeGreaterThanOrEqual(c.placed);

      // A quote that appears exactly once in each revision must land on that one occurrence.
      const once = (t: string, q: string) => t.indexOf(q) >= 0 && t.indexOf(q) === t.lastIndexOf(q);
      for (let i = 0; i < anchors.length; i++) {
        const q = anchors[i].exact;
        if (once(before.model.text, q) && once(after.model.text, q)) expect(found[i]?.start).toBe(after.model.text.indexOf(q));
      }
      // Fuzzy matches still read like the quote.
      for (let i = 0; i < anchors.length; i++) {
        const p = found[i];
        if (p && p.match === 'fuzzy' && !p.uncertain) expect(after.model.text.slice(p.start, p.end).length).toBeGreaterThan(anchors[i].exact.length * 0.5);
      }
    });
  }
});
