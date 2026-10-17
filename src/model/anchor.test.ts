import { describe, expect, it } from 'vitest';
import { findAnchor, makeAnchor, sectionAt, similarity, type ArticleText } from './anchor';
import { sentenceAt, sentencesOf } from './sentences';

/** An article text from paragraphs, with "## Heading" lines starting sections. */
function article(...blocks: string[]): ArticleText {
  const sections = [{ title: '', start: 0, end: 0 }];
  let text = '';
  for (const b of blocks) {
    if (b.startsWith('## ')) sections.push({ title: b.slice(3), start: text.length, end: 0 });
    text += (b.startsWith('## ') ? b.slice(3) : b) + '\n';
  }
  sections.forEach((s, i) => { s.end = sections[i + 1]?.start ?? text.length; });
  return { text, sections };
}

const anchorOf = (t: ArticleText, quote: string, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = t.text.indexOf(quote, i + 1);
  return makeAnchor(t, i, i + quote.length, 7)!;
};
const at = (t: ArticleText, p: { start: number; end: number } | null) => (p ? t.text.slice(p.start, p.end) : null);

const old = article(
  'The Peloponnesian War was fought between Athens and Sparta.',
  '## Background',
  'Athens had built an empire from the Delian League. Sparta feared its growth.',
  '## The war',
  'Sparta invaded Attica every summer. Athens feared the plague more than Sparta.',
);

describe('makeAnchor', () => {
  it('keeps the quote, its section, context on both sides and a position', () => {
    const a = anchorOf(old, 'Sparta invaded Attica every summer.');
    expect(a).toMatchObject({ revisionId: 7, section: 'The war', exact: 'Sparta invaded Attica every summer.', pos: old.text.indexOf('Sparta invaded') });
    expect(a.prefix!.endsWith('The war\n')).toBe(true);
    expect(a.suffix!.startsWith(' Athens feared')).toBe(true);
  });

  it('trims spaces and block breaks, and gives nothing for an empty span', () => {
    const i = old.text.indexOf('Sparta feared');
    expect(makeAnchor(old, i - 1, i + 13)!.exact).toBe('Sparta feared');
    expect(makeAnchor(old, i - 1, i)).toBeNull();
  });

  it('knows which section a position is in', () => {
    expect(sectionAt(old, 0).title).toBe('');
    expect(sectionAt(old, old.text.indexOf('plague')).title).toBe('The war');
  });
});

describe('findAnchor', () => {
  it('finds an unchanged quote exactly where it was', () => {
    const a = anchorOf(old, 'Athens had built an empire');
    expect(findAnchor(old, a)).toMatchObject({ match: 'exact', uncertain: false });
    expect(at(old, findAnchor(old, a))).toBe('Athens had built an empire');
  });

  it('follows a quote when text is added before it and its section moves', () => {
    const edited = article(
      '## Names',
      'Thucydides called it a war of the Athenians and Peloponnesians.',
      '## The war',
      'Sparta invaded Attica every summer. Athens feared the plague more than Sparta.',
      '## Background',
      'Athens had built an empire from the Delian League. Sparta feared its growth.',
    );
    const p = findAnchor(edited, anchorOf(old, 'Athens had built an empire from the Delian League.'));
    expect(p).toMatchObject({ match: 'exact', uncertain: false });
    expect(sectionAt(edited, p!.start).title).toBe('Background');
  });

  it('picks the repeat whose context matches, not the first one', () => {
    // "Sparta" appears four times; the one in "feared the plague more than Sparta" is the third.
    const a = anchorOf(old, 'Sparta', 3);
    const p = findAnchor(old, a)!;
    expect(old.text.slice(p.start - 10, p.end)).toBe('more than Sparta');
  });

  it('finds a reworded quote fuzzily', () => {
    const edited = article(
      'The Peloponnesian War was fought between Athens and Sparta.',
      '## Background',
      'Athens had built an empire out of the Delian League. Sparta feared its growth.',
    );
    const p = findAnchor(edited, anchorOf(old, 'Athens had built an empire from the Delian League.'));
    expect(p).toMatchObject({ match: 'fuzzy', uncertain: false });
    expect(at(edited, p)).toContain('out of the Delian League');
  });

  it('gives up on a quote that was deleted', () => {
    const edited = article('The Peloponnesian War was fought between Athens and Sparta.', '## The war', 'Sparta invaded Attica every summer.');
    expect(findAnchor(edited, anchorOf(old, 'Athens had built an empire from the Delian League.'))).toBeNull();
  });

  it('never puts a short phrase in a stranger’s place without flagging it', () => {
    const a = anchorOf(old, 'Sparta feared');
    const edited = article('Long before, Sparta feared nobody at all.', '## Background', 'Athens had built an empire. The Spartans worried.');
    const p = findAnchor(edited, a);
    expect(p === null || p.uncertain).toBe(true);
  });

  it('flags a fuzzy match outside its section with little matching context as uncertain', () => {
    const a = anchorOf(old, 'Athens feared the plague more than Sparta.');
    const edited = article('## Elsewhere', 'Rome feared the plague more than Carthage did.');
    const p = findAnchor(edited, a);
    if (p) expect(p.uncertain).toBe(true);
  });

  it('places quotes saved without context or position (prefix, suffix and pos are optional)', () => {
    expect(at(old, findAnchor(old, { exact: 'Sparta invaded Attica' }))).toBe('Sparta invaded Attica');
  });
});

describe('similarity', () => {
  it('is 1 for equal strings and falls with edits', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abcd', 'abed')).toBe(0.75);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('sentences', () => {
  it('splits a paragraph into sentences, never across blocks', () => {
    const t = 'Athens fell. Sparta won\nA new paragraph.';
    expect(sentencesOf(t).map(([s, e]) => t.slice(s, e))).toEqual(['Athens fell.', 'Sparta won', 'A new paragraph.']);
  });

  it('doesn’t end a sentence after an abbreviation', () => {
    const t = 'Pericles died c. 429 BC of the plague. Cleon followed him.';
    expect(sentencesOf(t).map(([s, e]) => t.slice(s, e))).toEqual(['Pericles died c. 429 BC of the plague.', 'Cleon followed him.']);
  });

  it('finds the sentence under an index', () => {
    const t = 'One. Two.';
    const s = sentencesOf(t);
    expect(sentenceAt(s, t.indexOf('Two'))).toBe(1);
    expect(sentenceAt(s, t.indexOf('One'))).toBe(0);
    expect(sentenceAt(s, 4)).toBe(-1);
  });
});
