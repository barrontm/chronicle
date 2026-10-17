import type { ArticleText, TextSection } from '../../model/anchor';
import type { WikiLink } from '../../model/passage';

/**
 * The article on screen as one normalized string (what `src/model/anchor.ts`
 * matches against), with a map back to the DOM text nodes:
 *  - whitespace runs collapse to one space (re-renders shuffle whitespace)
 *  - footnote markers (`sup.fn`) are left out: their numbers change whenever a citation is added
 *  - the reader's own controls inside the article (`[data-ui]`) are left out
 *  - block boundaries become "\n", so words never run together across paragraphs
 *  - each heading starts a section
 *  - each wiki link (`a[data-wiki]`) is noted with where its text sits, for `src/model/passage.ts`
 */
export interface TextModel extends ArticleText {
  nodes: Text[];
  /** For each character: the index into `nodes` (-1 for a block break) and the offset in that node. */
  nodeOf: Int32Array;
  offOf: Int32Array;
  /** First and past-last character of each node (-1 when it adds nothing). */
  nodeStart: Int32Array;
  nodeEnd: Int32Array;
  /** Links to other articles, in reading order. */
  links: WikiLink[];
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'TR', 'TD', 'TH', 'TABLE', 'CAPTION', 'FIGURE', 'FIGCAPTION', 'BLOCKQUOTE', 'SECTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'PRE', 'MATH']);
const HEADING = /^H[1-6]$/;
const SPACE = /[\s​]/;

export function buildTextModel(root: Element): TextModel {
  const nodes: Text[] = [];
  const chars: string[] = [];
  const nodeOf: number[] = [];
  const offOf: number[] = [];
  const nodeStart: number[] = [];
  const nodeEnd: number[] = [];
  const sections: TextSection[] = [{ title: '', start: 0, end: 0 }];
  const links: WikiLink[] = [];
  let last = '\n'; // so leading whitespace is dropped

  const blockBreak = () => {
    if (last === '\n') return;
    chars.push('\n');
    nodeOf.push(-1);
    offOf.push(0);
    last = '\n';
  };

  const visit = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      const k = nodes.length;
      nodes.push(t);
      nodeStart.push(-1);
      nodeEnd.push(-1);
      const d = t.data;
      for (let i = 0; i < d.length; i++) {
        let c = d[i];
        if (SPACE.test(c)) {
          if (last === ' ' || last === '\n') continue;
          c = ' ';
        }
        chars.push(c);
        last = c;
        nodeOf.push(k);
        offOf.push(i);
        if (nodeStart[k] < 0) nodeStart[k] = chars.length - 1;
        nodeEnd[k] = chars.length;
      }
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    if (e.localName === 'sup' && e.classList.contains('fn')) return;
    if (e.hasAttribute('data-ui')) return; // the reader's own controls, not article text
    const block = BLOCK.has(e.tagName);
    if (block) blockBreak();
    if (HEADING.test(e.tagName)) sections.push({ title: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), start: chars.length, end: chars.length });
    const start = chars.length;
    for (let c = e.firstChild; c; c = c.nextSibling) visit(c);
    const wiki = e.localName === 'a' ? e.getAttribute('data-wiki') : null;
    if (wiki && chars.length > start) links.push({ start, end: chars.length, key: wiki });
    if (block) blockBreak();
  };
  visit(root);
  // Each section runs to the next one's start.
  for (let i = 0; i < sections.length; i++) sections[i].end = i + 1 < sections.length ? sections[i + 1].start : chars.length;

  return {
    text: chars.join(''),
    sections,
    nodes,
    nodeOf: Int32Array.from(nodeOf),
    offOf: Int32Array.from(offOf),
    nodeStart: Int32Array.from(nodeStart),
    nodeEnd: Int32Array.from(nodeEnd),
    links,
  };
}

/** Text [s, e) → a DOM Range over it. */
export function rangeOf(m: TextModel, s: number, e: number): Range {
  while (s < e && m.nodeOf[s] < 0) s++;
  while (e > s && m.nodeOf[e - 1] < 0) e--;
  const r = m.nodes[0].ownerDocument.createRange();
  r.setStart(m.nodes[m.nodeOf[s]], m.offOf[s]);
  r.setEnd(m.nodes[m.nodeOf[e - 1]], m.offOf[e - 1] + 1);
  return r;
}

/** The model index of the first character at or after a DOM point inside a text node, or -1. */
function indexInNode(m: TextModel, k: number, offset: number, fromEnd: boolean): number {
  if (m.nodeStart[k] < 0) return -1;
  if (fromEnd) {
    let e = m.nodeStart[k];
    for (let i = m.nodeStart[k]; i < m.nodeEnd[k]; i++) if (m.nodeOf[i] === k && m.offOf[i] < offset) e = i + 1;
    return e;
  }
  for (let i = m.nodeStart[k]; i < m.nodeEnd[k]; i++) if (m.nodeOf[i] === k && m.offOf[i] >= offset) return i;
  return m.nodeEnd[k];
}

/** A DOM Range → text [s, e), trimmed. Null when it holds no article text. */
export function indicesOf(m: TextModel, r: Range): [number, number] | null {
  const n = m.nodes.length;
  let s = -1;
  let e = -1;
  if (r.startContainer.nodeType === Node.TEXT_NODE) {
    const k = m.nodes.indexOf(r.startContainer as Text);
    if (k >= 0) s = indexInNode(m, k, r.startOffset, false);
  }
  if (s < 0) {
    // The first node that starts inside the range.
    let k = 0;
    while (k < n && (m.nodeStart[k] < 0 || r.comparePoint(m.nodes[k], 0) < 0)) k++;
    if (k === n) return null;
    s = m.nodeStart[k];
  }
  if (r.endContainer.nodeType === Node.TEXT_NODE) {
    const k = m.nodes.indexOf(r.endContainer as Text);
    if (k >= 0) e = indexInNode(m, k, r.endOffset, true);
  }
  if (e < 0) {
    // The last node that ends inside the range.
    let k = n - 1;
    while (k >= 0 && (m.nodeStart[k] < 0 || r.comparePoint(m.nodes[k], m.nodes[k].length) > 0)) k--;
    if (k < 0) return null;
    e = m.nodeEnd[k];
  }
  while (s < e && (m.text[s] === ' ' || m.text[s] === '\n')) s++;
  while (e > s && (m.text[e - 1] === ' ' || m.text[e - 1] === '\n')) e--;
  return e > s ? [s, e] : null;
}

/** The text index under a screen point, or -1 when it isn't on article text. */
export function indexAtPoint(m: TextModel, root: Element, x: number, y: number): number {
  const d = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let off = 0;
  if (d.caretPositionFromPoint) {
    const c = d.caretPositionFromPoint(x, y);
    if (c) { node = c.offsetNode; off = c.offset; }
  } else if (d.caretRangeFromPoint) {
    const c = d.caretRangeFromPoint(x, y);
    if (c) { node = c.startContainer; off = c.startOffset; }
  }
  if (!node || !root.contains(node) || node.nodeType !== Node.TEXT_NODE) return -1;
  const k = m.nodes.indexOf(node as Text);
  if (k < 0 || m.nodeStart[k] < 0) return -1;
  return Math.min(indexInNode(m, k, off, false), m.nodeEnd[k] - 1);
}
