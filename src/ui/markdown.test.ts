import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, slug } from './markdown';

describe('markdown', () => {
  it('reads headings with ids for jumping to them', () => {
    expect(parseMarkdown('# Chronicle\n## The map & Territories')).toEqual([
      { t: 'h', level: 1, id: 'chronicle', c: ['Chronicle'] },
      { t: 'h', level: 2, id: 'the-map-territories', c: ['The map & Territories'] },
    ]);
    expect(slug('Café: “Dates” BCE')).toBe('cafe-dates-bce');
  });

  it('joins paragraph lines and splits on blank lines', () => {
    expect(parseMarkdown('One\ntwo\n\nThree')).toEqual([{ t: 'p', c: ['One two'] }, { t: 'p', c: ['Three'] }]);
  });

  it('reads bulleted and numbered lists, with wrapped items', () => {
    expect(parseMarkdown('- a\n  more\n- b\n\n1. first\n2. second')).toEqual([
      { t: 'ul', items: [['a more'], ['b']] },
      { t: 'ol', items: [['first'], ['second']] },
    ]);
  });

  it('reads tips', () => {
    expect(parseMarkdown('> Press Esc\n> to cancel.')).toEqual([{ t: 'tip', c: ['Press Esc to cancel.'] }]);
  });

  it('reads nested inline marks and code', () => {
    expect(parseInline('Click **Add *now*** or `Esc`.')).toEqual([
      'Click ', { t: 'b', c: ['Add ', { t: 'i', c: ['now'] }] }, ' or ', { t: 'code', c: 'Esc' }, '.',
    ]);
  });

  it('follows only web links and in-page anchors', () => {
    expect(parseInline('[site](https://example.org) [here](#map)')).toEqual([
      { t: 'a', href: 'https://example.org', c: ['site'] }, ' ', { t: 'a', href: '#map', c: ['here'] },
    ]);
    expect(parseInline('[bad](javascript:void)')).toEqual(['bad']);
  });

  it('keeps stray markup as plain text', () => {
    expect(parseInline('<b>hi</b>')).toEqual(['<b>hi</b>']);
  });
});
