/**
 * A small Markdown subset for the manual (and later, notes): headings, paragraphs,
 * lists, tips (`> `), **bold**, *italic*, `code` and [links](url). It returns a
 * tree that React renders as elements, never HTML strings, so text can't inject markup.
 */
export type Inline =
  | string
  | { t: 'b' | 'i'; c: Inline[] }
  | { t: 'code'; c: string }
  | { t: 'a'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; id: string; c: Inline[] }
  | { t: 'p' | 'tip'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] };

export function slug(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Only web links and in-page anchors are followed; anything else is shown as text. */
const safeHref = (href: string) => /^(https?:\/\/|#)/.test(href);

const INLINE = /`([^`]+)`|\*\*((?:[^*]|\*[^*]+\*)+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const [whole, code, bold, italic, label, href] = m;
    if (code !== undefined) out.push({ t: 'code', c: code });
    else if (bold !== undefined) out.push({ t: 'b', c: parseInline(bold) });
    else if (italic !== undefined) out.push({ t: 'i', c: parseInline(italic) });
    else if (safeHref(href)) out.push({ t: 'a', href, c: parseInline(label) });
    else out.push(...parseInline(label));
    rest = rest.slice(m.index + whole.length);
  }
  // Join neighbouring strings so the tree stays small.
  return out.reduce<Inline[]>((acc, x) => {
    if (typeof x === 'string' && typeof acc.at(-1) === 'string') acc[acc.length - 1] = (acc.at(-1) as string) + x;
    else acc.push(x);
    return acc;
  }, []);
}

const textOf = (c: Inline[]): string => c.map((x) => (typeof x === 'string' ? x : typeof x.c === 'string' ? x.c : textOf(x.c))).join('');

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let tip: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
    if (tip.length) blocks.push({ t: 'tip', c: parseInline(tip.join(' ')) });
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) });
    para = [];
    tip = [];
    list = null;
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      const c = parseInline(h[2]);
      blocks.push({ t: 'h', level: h[1].length as 1 | 2 | 3, id: slug(textOf(c)), c });
    } else if (ul || ol) {
      const t = ul ? 'ul' : 'ol';
      if (!list || list.t !== t) { flush(); list = { t, items: [] }; }
      list.items.push((ul ?? ol)![1]);
    } else if (q) {
      if (!tip.length) flush();
      tip.push(q[1]);
    } else if (list && /^\s+/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list || tip.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}
