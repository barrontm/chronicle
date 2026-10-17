// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ArticleCache } from '../data/articleCache';
import { articleKey, articleSource, buildArticleUrl, parseArticle } from './article';
import { sanitizeParsoid } from './sanitize';

const page = (body: string, rev = 1) =>
  `<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/${rev}"><head><title>Pericles</title>` +
  `<meta property="dc:modified" content="2026-10-01T12:00:00.000Z"/><meta property="mw:pageId" content="24321"/></head>` +
  `<body><section data-mw-section-id="0">${body}</section></body></html>`;

describe('sanitizeParsoid', () => {
  it('reads the revision, page id and date from the page', () => {
    const s = sanitizeParsoid(page('<p>Hi</p>', 1379806684));
    expect(s).toMatchObject({ title: 'Pericles', revisionId: 1379806684, pageId: 24321, modified: '2026-10-01T12:00:00.000Z' });
  });

  it('keeps wiki links openable in the reader and drops edit links and navboxes', () => {
    const s = sanitizeParsoid(page(
      '<p>Son of <a rel="mw:WikiLink" href="./Xanthippus" title="Xanthippus">Xanthippus</a>.<span class="mw-editsection">edit</span></p>' +
      '<div class="navbox">nav</div>',
    ), { pageTitle: 'Pericles' });
    expect(s.html).toContain('data-wiki="Xanthippus"');
    expect(s.html).toContain('href="https://en.wikipedia.org/wiki/Xanthippus"');
    expect(s.html).not.toContain('edit');
    expect(s.html).not.toContain('nav');
  });

  it('turns footnote markers into small links and keeps section ids', () => {
    const s = sanitizeParsoid(page('<p>Text<sup class="mw-ref reference"><a href="./Pericles#cite_note-1"><span class="mw-reflink-text">[1]</span></a></sup></p>'));
    expect(s.html).toContain('<sup class="fn"><a href="#cite_note-1" data-fn="cite_note-1">1</a></sup>');
    expect(s.html).toContain('data-s="0"');
  });

  it('loads pictures only from Wikimedia and credits them', () => {
    const s = sanitizeParsoid(page(
      '<figure><a class="mw-file-description" href="./File:Pericles.jpg"><img resource="./File:Pericles_Pio-Clementino.jpg" src="//upload.wikimedia.org/wikipedia/commons/thumb/a/a1/P.jpg/220px-P.jpg" width="220" height="300"/></a><figcaption>Bust</figcaption></figure>' +
      '<img src="https://evil.example/track.png">',
    ));
    expect(s.html).toContain('src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/P.jpg/220px-P.jpg"');
    expect(s.html).toContain('crossorigin="anonymous"');
    expect(s.html).toContain('Picture credit and licence');
    expect(s.html).not.toContain('evil.example');
  });

  // From the reader spike: none of these may survive into the output, or after a re-parse.
  const attacks = [
    '<img src=x onerror="window.__x=1">', '<a href="javascript:window.__x=1">x</a>', '<a rel="mw:ExtLink" href="javascript:window.__x=1">e</a>',
    '<a rel="mw:ExtLink" href="data:text/html,<script>window.__x=1</script>">d</a>', '<svg><script>window.__x=1</script></svg>',
    '<svg><a xlink:href="javascript:window.__x=1"><text>t</text></a></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror="window.__x=1">', '<math><mi xlink:href="javascript:window.__x=1">q</mi></math>',
    '<img src="https://evil.example/track.png">', '<img src="//upload.wikimedia.org.evil.example/x.png">', '<img src="https://upload.wikimedia.org@evil.example/x.png">',
    '<img src="data:image/svg+xml,<svg onload=window.__x=1>">', '<a rel="mw:WikiLink" href="./Foo" onclick="window.__x=1" title="a">w</a>',
    '<iframe srcdoc="<script>window.__x=1</script>"></iframe>', '<form action="https://evil.example"><input name=q><button>go</button></form>',
    '<style>@import url(https://evil.example/x.css);</style>', '<div style="background:url(javascript:window.__x=1)">s</div>', '<p onmouseover="window.__x=1">p</p>',
    '<span typeof="mw:Extension/math"><math><semantics><annotation encoding="x">a</annotation><mi onclick="window.__x=1">z</mi></semantics></math></span>',
    '<noscript><p title="</noscript><img src=x onerror=window.__x=1>"></noscript>', '<template><img src=x onerror=window.__x=1></template>', '<object data="javascript:window.__x=1"></object>',
    '<a rel="mw:WikiLink" href="./Foo&quot; onmouseover=&quot;window.__x=1">q</a>', '<table><td colspan="1 onclick=window.__x=1">c</td></table>',
  ];
  // Checked on the parsed output: only known attributes, and every URL points somewhere safe.
  const ATTRS = new Set(['class', 'href', 'src', 'srcset', 'width', 'height', 'alt', 'loading', 'decoding', 'crossorigin', 'target', 'rel', 'data-wiki', 'data-frag', 'data-fn', 'data-s', 'id', 'colspan', 'rowspan', 'scope', 'start', 'display', 'alttext']);
  const BAD_TAGS = /^(script|svg|style|iframe|form|input|button|object|embed|template|noscript|mglyph|annotation|link|meta)$/i;
  const SAFE_URL = /^(https:\/\/(en\.wikipedia\.org|upload\.wikimedia\.org)\/|#)/;
  it.each(attacks)('neutralizes %s', (a) => {
    const out = sanitizeParsoid(page(`<p>${a}</p>`)).html;
    for (const el of new DOMParser().parseFromString(out, 'text/html').body.querySelectorAll('*')) {
      expect(el.localName).not.toMatch(BAD_TAGS);
      for (const attr of el.attributes) {
        expect(ATTRS.has(attr.name), attr.name).toBe(true);
        if (attr.name === 'href' || attr.name === 'src') expect(attr.value).toMatch(SAFE_URL);
      }
    }
  });
});

describe('articles', () => {
  it('builds the Parsoid URL and keys from titles', () => {
    expect(articleKey('Battle of Marathon')).toBe('Battle_of_Marathon');
    expect(buildArticleUrl('Athens–Sparta')).toBe('https://en.wikipedia.org/w/rest.php/v1/page/Athens%E2%80%93Sparta/html');
  });

  it('parses an article and keeps it in the device cache', async () => {
    const a = parseArticle('Pericles', page('<p>Pericles was a Greek statesman.</p>', 7), 1000);
    expect(a).toMatchObject({ key: 'Pericles', title: 'Pericles', revisionId: 7, fetchedAt: 1000 });
    const cache = new ArticleCache('test-articles');
    expect(await cache.get('Pericles')).toBeUndefined();
    await cache.put(a);
    expect((await cache.get('Pericles'))?.html).toContain('Greek statesman');
    expect(await cache.keys()).toEqual(['Pericles']);
    await cache.putSubject({ key: 'Pericles', subject: { qid: 'Q80398', kind: 'person', facts: { partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] }, labels: {} }, fetchedAt: 1000 });
    expect((await cache.getSubject('Pericles'))?.subject?.kind).toBe('person');
    expect(await cache.getSubject('Athens')).toBeUndefined();
  });
});

describe('articleSource', () => {
  it('reuses the source Bob already has for the page, or makes a new one', () => {
    const made = articleSource([], { key: 'Peloponnesian_War', title: 'Peloponnesian War' }, '2026-10-17');
    expect(made.isNew).toBe(true);
    expect(made.source).toMatchObject({ kind: 'web', title: 'Peloponnesian War', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Peloponnesian_War', accessed: '2026-10-17' });
    const again = articleSource([made.source], { key: 'Peloponnesian_War', title: 'Peloponnesian War' }, '2026-10-18');
    expect(again).toEqual({ source: made.source, isNew: false });
  });
});
