/**
 * Parsoid HTML -> the small HTML Chronicle's reader shows (from the Phase 0 reader spike). A DOMParser walker with an allowlist:
 * it BUILDS a new tree (createElement + setAttribute from allowlists), so anything it does not
 * know about simply never reaches the output. DOMParser documents are inert (no scripts, no loads).
 */
export interface Sanitized {
  html: string;
  title: string;
  revisionId: number | null;
  modified: string | null;
  pageId: number | null;
  stats: { in: number; out: number; nodesIn: number; nodesOut: number; imgs: number; figures: number; footnotes: number; links: number; tables: number; math: number };
}

const MATHML = 'http://www.w3.org/1998/Math/MathML';

// Elements we keep as they are.
const KEEP = new Set(['section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'sub', 'sup', 'small', 'br', 'hr', 'blockquote', 'q', 'cite', 'abbr', 'code', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'figure', 'figcaption', 'time', 'span']);
// Dropped together with their contents.
const DROP = new Set(['script', 'style', 'link', 'meta', 'base', 'noscript', 'template', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'source', 'track', 'canvas', 'svg', 'head', 'title', 'map', 'area']);
const MATH_TAGS = new Set(['math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mstyle', 'mpadded', 'mfenced']);
// Dropped by class (navboxes, maintenance banners, edit links, print-only, empty wrappers...).
const DROP_CLASS = /(^|\s)(navbox|navbox-styles|vertical-navbox|mw-editsection|noprint|metadata|ambox|mbox-small|sidebar|Z3988|mw-empty-elt|mw-authority-control|sistersitebox|side-box|shortdescription|toc|navigation-not-searchable-x|mw-collapsible-toggle|mw-cite-backlink|portal|reflist-x|external-links-x|printfooter|catlinks|ext-phonos|mw-jump-link|hidden-x)(\s|$)/;
const KEEP_CLASS = new Set(['infobox', 'infobox-x', 'wikitable', 'hatnote', 'plainlist', 'hlist', 'mw-halign-left', 'mw-halign-right', 'mw-halign-center', 'mw-halign-none', 'nowrap', 'reference-text', 'mw-references', 'references', 'treelist', 'sortable', 'vevent', 'vcard']);
const NON_ARTICLE_NS = /^(File|Image|Media|Category|Special|Template|Template_talk|Talk|User|User_talk|Help|Portal|Wikipedia|Draft|Module|MediaWiki|Book|TimedText):/i;

const IMG_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

function cleanClass(cls: string | null): string {
  if (!cls) return '';
  return cls.split(/\s+/).filter(c => KEEP_CLASS.has(c)).join(' ');
}

function absUrl(u: string): URL | null {
  try { return new URL(u.startsWith('//') ? 'https:' + u : u, 'https://en.wikipedia.org/wiki/'); } catch { return null; }
}

/** Image URL we are willing to load: Wikimedia's own hosts only, always https, no tracking query. */
function imgUrl(u: string): string | null {
  const url = absUrl(u);
  if (!url || url.protocol !== 'https:' || !IMG_HOSTS.has(url.hostname)) return null;
  // Same bytes from upload.wikimedia.org, which the service worker already caches.
  return `https://upload.wikimedia.org${url.pathname}`;
}

function fileNameOf(resource: string | null): string | null {
  if (!resource) return null;
  const m = /File:(.+)$/.exec(decodeURIComponent(resource));
  return m ? m[1].replace(/_/g, ' ') : null;
}

function isHidden(el: Element): boolean {
  const st = el.getAttribute('style');
  return !!st && /display\s*:\s*none/i.test(st);
}

export interface Options { pageTitle?: string }

export function sanitizeParsoid(raw: string, opts: Options = {}): Sanitized {
  const src = new DOMParser().parseFromString(raw, 'text/html');
  const doc = document.implementation.createHTMLDocument('');
  const out = doc.createElement('div');
  const stats = { in: raw.length, out: 0, nodesIn: src.body.querySelectorAll('*').length, nodesOut: 0, imgs: 0, figures: 0, footnotes: 0, links: 0, tables: 0, math: 0 };
  const about = src.documentElement.getAttribute('about') ?? '';
  const revMatch = /revision\/(\d+)/.exec(about);
  const meta = (p: string) => src.querySelector(`meta[property="${p}"]`)?.getAttribute('content') ?? null;
  const title = src.title || '';
  const pageTitle = opts.pageTitle ?? title.replace(/ /g, '_');

  function el(tag: string): HTMLElement { return doc.createElement(tag); }

  /** Append the sanitized children of `from` to `to`. */
  function walkChildren(from: Node, to: Node): void {
    for (let n = from.firstChild; n; n = n.nextSibling) walk(n, to);
  }

  function walk(n: Node, to: Node): void {
    if (n.nodeType === 3) { to.appendChild(doc.createTextNode((n as Text).data)); return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.localName;
    if (DROP.has(tag)) return;
    const cls = e.getAttribute('class') ?? '';
    if (DROP_CLASS.test(cls)) return;
    if (isHidden(e) && !e.classList.contains('mwe-math-mathml-a11y')) return;
    const typeOf = e.getAttribute('typeof') ?? '';
    const rel = e.getAttribute('rel') ?? '';

    // --- footnote marker: <sup class="mw-ref"> -> <sup class="fn"><a href="#cite_note-1">1</a></sup>
    if (tag === 'sup' && e.classList.contains('mw-ref')) {
      const a = e.querySelector('a');
      const href = a?.getAttribute('href') ?? '';
      const id = href.slice(href.indexOf('#') + 1);
      const label = (e.querySelector('.mw-reflink-text')?.textContent ?? '').replace(/[[\]]/g, '').trim();
      if (id && label) {
        const sup = el('sup'); sup.className = 'fn';
        const fa = el('a'); fa.setAttribute('href', '#' + id); fa.setAttribute('data-fn', id); fa.textContent = label;
        sup.appendChild(fa); to.appendChild(sup); stats.footnotes++;
      }
      return;
    }

    // --- math: keep the MathML (themeable, offline), drop the SVG fallback image
    if (typeOf.includes('mw:Extension/math')) {
      const m = e.querySelector('math');
      if (m) { to.appendChild(copyMath(m)); stats.math++; }
      return;
    }

    // --- figures
    if (tag === 'figure') {
      const img = e.querySelector('img');
      const src0 = img && imgUrl(img.getAttribute('src') ?? '');
      if (!img || !src0) return;
      const fig = el('figure');
      const c = cleanClass(cls) || ''; if (c) fig.className = c;
      const file = fileNameOf(img.getAttribute('resource'));
      fig.appendChild(copyImg(img, src0));
      const cap = e.querySelector('figcaption');
      const fc = el('figcaption');
      if (cap) walkChildren(cap, fc);
      if (file) {
        const credit = el('a'); credit.className = 'credit ext'; credit.setAttribute('target', '_blank'); credit.setAttribute('rel', 'noopener noreferrer');
        credit.setAttribute('href', 'https://en.wikipedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_')));
        credit.textContent = 'Picture credit and licence';
        fc.appendChild(doc.createTextNode(' ')); fc.appendChild(credit);
      }
      fig.appendChild(fc); to.appendChild(fig); stats.figures++;
      return;
    }

    // --- images in running text / infoboxes
    if (tag === 'img') {
      const s = imgUrl(e.getAttribute('src') ?? '');
      if (s) { to.appendChild(copyImg(e, s)); }
      return;
    }

    // --- links
    if (tag === 'a') {
      const href = e.getAttribute('href') ?? '';
      if (rel.includes('mw:WikiLink') && !rel.includes('Interwiki')) {
        // Links around images (File:) are unwrapped; the image is handled above.
        const t = decodeURIComponent(href.replace(/^\.\//, '').split('#')[0]);
        const frag = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
        if (e.classList.contains('new') || e.classList.contains('mw-selflink')) { walkChildren(e, to); return; }
        if (e.classList.contains('mw-file-description') || /^(File|Image|Media):/i.test(t)) { walkChildren(e, to); return; }
        if (NON_ARTICLE_NS.test(t)) {
          const a = el('a'); a.className = 'ext'; a.setAttribute('href', 'https://en.wikipedia.org/wiki/' + href.replace(/^\.\//, ''));
          a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
          walkChildren(e, a); to.appendChild(a); return;
        }
        if (t === pageTitle || t === '') {
          // same-page link
          const a = el('a'); a.className = 'wl self'; a.setAttribute('href', '#' + frag); if (frag) a.setAttribute('data-frag', frag);
          walkChildren(e, a); to.appendChild(a); return;
        }
        // The reader opens these itself (by `data-wiki`); the real URL keeps "open in new tab" working.
        const a = el('a'); a.className = 'wl';
        a.setAttribute('href', 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_')) + (frag ? '#' + encodeURIComponent(frag) : ''));
        a.setAttribute('data-wiki', t); if (frag) a.setAttribute('data-frag', frag);
        walkChildren(e, a); to.appendChild(a); stats.links++; return;
      }
      if (rel.includes('mw:ExtLink') || rel.includes('Interwiki')) {
        const u = absUrl(href);
        if (u && (u.protocol === 'https:' || u.protocol === 'http:')) {
          const a = el('a'); a.className = 'ext'; a.setAttribute('href', u.href);
          a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer nofollow');
          walkChildren(e, a); to.appendChild(a); return;
        }
      }
      walkChildren(e, to); return; // anything else: keep the words, lose the link
    }

    // --- reference list items: <li id="cite_note-1"> keep id, drop backlinks (class dropped above)
    if (tag === 'li' && /^cite_note-/.test(e.id)) {
      const li = el('li'); li.id = e.id;
      const body = e.querySelector('.mw-reference-text') ?? e;
      walkChildren(body, li); to.appendChild(li); return;
    }

    // --- known elements
    if (KEEP.has(tag)) {
      // spans and bare divs carry no meaning of their own once styles are gone: unwrap unless classed
      const c = cleanClass(cls);
      if ((tag === 'span') && !c) { walkChildren(e, to); return; }
      const copy = el(tag);
      if (c) copy.className = c;
      if (tag === 'section') { const id = e.getAttribute('data-mw-section-id'); if (id != null) copy.setAttribute('data-s', id); }
      if (/^h[1-6]$/.test(tag) && e.id) copy.id = e.id;
      if (tag === 'td' || tag === 'th') {
        for (const a of ['colspan', 'rowspan', 'scope']) { const v = e.getAttribute(a); if (v && /^\w{1,8}$/.test(v)) copy.setAttribute(a, v); }
      }
      if (tag === 'table') {
        stats.tables++;
        // A scroll wrapper so wide tables never widen the phone's page.
        const wrap = el('div'); wrap.className = 'tbl';
        walkChildren(e, copy); wrap.appendChild(copy); to.appendChild(wrap); return;
      }
      if (tag === 'ol') { const st = e.getAttribute('start'); if (st && /^\d+$/.test(st)) copy.setAttribute('start', st); }
      walkChildren(e, copy);
      // drop wrappers that came out empty (no text, no images)
      if ((tag === 'div' || tag === 'p' || tag === 'li') && !copy.textContent!.trim() && !copy.querySelector('img,math,figure')) return;
      to.appendChild(copy); return;
    }

    if (MATH_TAGS.has(tag)) return; // stray MathML outside a math wrapper: ignore
    // unknown element (bdi, center, font, ...): keep its children
    walkChildren(e, to);
  }

  function copyImg(img: Element, src: string): HTMLElement {
    const i = el('img');
    i.setAttribute('src', src);
    const ss = img.getAttribute('srcset');
    if (ss) {
      const parts = ss.split(',').map(p => p.trim().split(/\s+/)).map(([u, d]) => [imgUrl(u), d] as const).filter(([u]) => u);
      if (parts.length) i.setAttribute('srcset', parts.map(([u, d]) => `${u} ${d ?? ''}`.trim()).join(', '));
    }
    for (const a of ['width', 'height']) { const v = img.getAttribute(a); if (v && /^\d{1,4}$/.test(v)) i.setAttribute(a, v); }
    i.setAttribute('alt', img.getAttribute('alt') ?? '');
    i.setAttribute('loading', 'lazy'); i.setAttribute('decoding', 'async');
    i.setAttribute('crossorigin', 'anonymous'); // CORS-enabled, so the service worker's cache holds real (not opaque) responses
    stats.imgs++;
    return i;
  }

  function copyMath(m: Element): Element {
    const c = doc.createElementNS(MATHML, m.localName);
    if (m.localName === 'math') { c.setAttribute('display', m.getAttribute('display') === 'block' ? 'block' : 'inline'); const alt = m.getAttribute('alttext'); if (alt) c.setAttribute('alttext', alt); }
    for (let n = m.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { c.appendChild(doc.createTextNode((n as Text).data.replace(/\s+/g, ' '))); continue; }
      if (n.nodeType !== 1) continue;
      const t = (n as Element).localName;
      if (t === 'annotation' || t === 'annotation-xml' || !MATH_TAGS.has(t)) continue;
      c.appendChild(copyMath(n as Element));
    }
    return c;
  }

  walkChildren(src.body, out);
  // Parsoid's trailing "References" section keeps its heading, the list inside it is the footnote text.
  stats.nodesOut = out.querySelectorAll('*').length;
  const html = out.innerHTML;
  stats.out = html.length;
  return {
    html, title: title || pageTitle, revisionId: revMatch ? Number(revMatch[1]) : null,
    modified: meta('dc:modified'), pageId: meta('mw:pageId') ? Number(meta('mw:pageId')) : null, stats,
  };
}
