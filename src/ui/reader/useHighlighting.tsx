import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { articleSource, type Article } from '../../media/article';
import { findAnchor, makeAnchor, type Placement } from '../../model/anchor';
import { newId, upsert, remove } from '../../model/doc';
import { sentenceAt, sentencesOf } from '../../model/sentences';
import type { Dimension, Highlight } from '../../model/types';
import { useDoc } from '../DocContext';
import { buildTextModel, indexAtPoint, indicesOf, rangeOf, type TextModel } from './textModel';

/**
 * Highlighting in the reader: select words, then "Highlight" (H on the
 * laptop), or on a touch screen tap a sentence. Each highlight is saved the
 * moment it's made, quoting the article as a source.
 *
 * Marks are drawn with the CSS Custom Highlight API, which leaves the DOM (and
 * so the text model) alone; screen readers get the list and announcements instead.
 */

type MarkState = 'open' | 'kept' | 'added';
export const PIGMENT: Record<Dimension | 'none', string> = {
  political: 'lapis', economic: 'ochre', social: 'madder', technological: 'verdigris', intellectual: 'indigo', religious: 'cinnabar', none: 'umber',
};
const MARK = 'chronicle-mark';
const UNSURE = 'chronicle-unsure';
const PRIORITY: Record<MarkState, number> = { kept: 0, added: 1, open: 2 };

interface Highlights { clear(): void; set(name: string, h: unknown): void; delete(name: string): void; keys(): IterableIterator<string> }
const registry = (): Highlights | null => (typeof CSS !== 'undefined' && 'highlights' in CSS ? (CSS as unknown as { highlights: Highlights }).highlights : null);
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => { priority: number } }).Highlight;

const NO_LINKS: TextModel['links'] = [];

export interface Placed { highlight: Highlight; at: Placement | null; state: MarkState }

/** Where the Highlight / Remove button sits: above a point on the laptop, or docked at the bottom. */
export type ToolSpot = { x: number; y: number } | 'docked';

const isTouchFirst = () => matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useHighlighting(body: RefObject<HTMLDivElement | null>, article: Article | null, subjectQid?: string) {
  const { doc, update, readOnly } = useDoc();
  const [model, setModel] = useState<TextModel | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ s: number; e: number; spot: ToolSpot } | null>(null);
  const [announce, setAnnounce] = useState('');
  // Bumped when the page scrolls or resizes, so the button follows its mark.
  const [, setMoved] = useState(0);
  // iOS can drop the selection when the button is touched, so the last one is remembered briefly.
  const lastSelection = useRef<{ s: number; e: number; at: number } | null>(null);
  const lastPointer = useRef('mouse');

  useLayoutEffect(() => {
    setModel(article && body.current ? buildTextModel(body.current) : null);
    setOpenId(null);
  }, [article, body]);

  const sentences = useMemo(() => (model ? sentencesOf(model.text) : []), [model]);
  const source = useMemo(() => (article ? articleSource(doc.sources, article, '').source : null), [doc.sources, article]);
  const savedSource = source && doc.sources.some((s) => s.id === source.id) ? source : null;

  const placed: Placed[] = useMemo(() => {
    if (!model || !savedSource) return [];
    return doc.highlights
      .filter((h) => h.sourceId === savedSource.id && h.anchor)
      .map((h) => ({ highlight: h, at: findAnchor(model, h.anchor!), state: h.id === openId ? 'open' : h.usedBy.length ? 'added' : 'kept' }));
  }, [model, savedSource, doc.highlights, openId]);

  // Draw the marks.
  useEffect(() => {
    const reg = registry();
    if (!reg || !HighlightCtor || !model) return;
    const groups = new Map<string, Range[]>();
    const unsure: Range[] = [];
    for (const p of placed) {
      if (!p.at) continue;
      const r = rangeOf(model, p.at.start, p.at.end);
      const name = `${MARK}-${PIGMENT[p.highlight.dimension ?? 'none']}-${p.state}`;
      groups.set(name, [...(groups.get(name) ?? []), r]);
      if (p.at.uncertain) unsure.push(r);
    }
    for (const name of [...reg.keys()]) if (name.startsWith('chronicle-')) reg.delete(name);
    for (const [name, ranges] of groups) {
      const h = new HighlightCtor(...ranges);
      h.priority = PRIORITY[name.slice(name.lastIndexOf('-') + 1) as MarkState];
      reg.set(name, h);
    }
    if (unsure.length) {
      const h = new HighlightCtor(...unsure);
      h.priority = 3;
      reg.set(UNSURE, h);
    }
    return () => { for (const name of [...reg.keys()]) if (name.startsWith('chronicle-')) reg.delete(name); };
  }, [placed, model]);

  const open = placed.find((p) => p.highlight.id === openId && p.at) ?? null;

  /** Save [s, e) as a new highlight, or as the new extent of `existing`. */
  const save = useCallback((s: number, e: number, existing?: Highlight) => {
    if (!model || !article || readOnly) return;
    const anchor = makeAnchor(model, s, e, article.revisionId ?? undefined);
    if (!anchor) return;
    const id = existing?.id ?? newId('h');
    update((d) => {
      const { source: src, isNew } = articleSource(d.sources, article, new Date().toISOString().slice(0, 10));
      const next = isNew ? upsert(d, 'sources', src) : d;
      const base = existing ?? { id, usedBy: [], ...(subjectQid ? { subjectQid } : {}) };
      return upsert(next, 'highlights', { ...base, sourceId: src.id, text: anchor.exact, anchor, updatedAt: 0 });
    });
    setOpenId(id);
    setAnnounce(`Highlighted: ${anchor.exact}`);
  }, [model, article, readOnly, update, subjectQid]);

  const highlightSelection = useCallback(() => {
    const sel = getSelection();
    let span: [number, number] | null = null;
    if (model && body.current && sel?.rangeCount && !sel.isCollapsed && body.current.contains(sel.getRangeAt(0).commonAncestorContainer)) span = indicesOf(model, sel.getRangeAt(0));
    else if (lastSelection.current && performance.now() - lastSelection.current.at < 4000) span = [lastSelection.current.s, lastSelection.current.e];
    lastSelection.current = null;
    if (!span) return;
    save(span[0], span[1]);
    sel?.removeAllRanges();
    setSelection(null);
  }, [model, body, save]);

  const removeOpen = useCallback(() => {
    if (!open) return;
    update((d) => remove(d, 'highlights', open.highlight.id));
    setOpenId(null);
    setAnnounce('Highlight removed');
  }, [open, update]);

  /** Close the open highlight's card; the highlight stays as it is. */
  const keep = useCallback(() => {
    if (open) setAnnounce('Highlight kept');
    setOpenId(null);
  }, [open]);

  const setDimension = useCallback((dimension: Dimension | undefined) => {
    if (!open || readOnly) return;
    const id = open.highlight.id;
    update((d) => {
      const h = d.highlights.find((x) => x.id === id);
      if (!h) return d;
      const { dimension: _, ...rest } = h;
      return upsert(d, 'highlights', dimension ? { ...rest, dimension } : rest);
    });
  }, [open, readOnly, update]);

  /** Say what the open highlight is about: the candidate Bob chose in "Becomes". */
  const setSubject = useCallback((qid: string) => {
    if (!open || readOnly || open.highlight.subjectQid === qid) return;
    const id = open.highlight.id;
    update((d) => {
      const h = d.highlights.find((x) => x.id === id);
      return h ? upsert(d, 'highlights', { ...h, subjectQid: qid }) : d;
    });
  }, [open, readOnly, update]);

  /** Make the open highlight evidence for a record Bob already has. */
  const link = useCallback((recordId: string) => {
    if (!open || readOnly) return;
    const id = open.highlight.id;
    update((d) => {
      const h = d.highlights.find((x) => x.id === id);
      return h && !h.usedBy.includes(recordId) ? upsert(d, 'highlights', { ...h, usedBy: [...h.usedBy, recordId] }) : d;
    });
  }, [open, readOnly, update]);

  // Follow the selection, and where the button goes.
  useEffect(() => {
    if (!model) return;
    let frame = 0;
    let moved = false;
    const follow = () => {
      frame = 0;
      if (moved) { moved = false; setMoved((n) => n + 1); }
      const sel = getSelection();
      const root = body.current;
      if (!root || !sel?.rangeCount || sel.isCollapsed || !root.contains(sel.getRangeAt(0).commonAncestorContainer)) { setSelection(null); return; }
      const range = sel.getRangeAt(0);
      const span = indicesOf(model, range);
      if (!span) { setSelection(null); return; }
      lastSelection.current = { s: span[0], e: span[1], at: performance.now() };
      const rect = range.getBoundingClientRect();
      setSelection({ s: span[0], e: span[1], spot: isTouchFirst() ? 'docked' : { x: rect.left + rect.width / 2, y: rect.top } });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(follow); };
    const onMove = () => { moved = true; schedule(); };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
    };
  }, [model, body]);

  // H highlights the selection; Escape lets go of the open highlight (it stays saved).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'h' || e.key === 'H') && selection) { e.preventDefault(); highlightSelection(); }
      else if (e.key === 'Escape' && openId) setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, openId, highlightSelection]);

  /** A click or tap in the text that isn't on a link: open a mark, or on touch highlight the sentence. */
  const onTextClick = useCallback((e: React.MouseEvent) => {
    if (!model || !body.current) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    const i = indexAtPoint(model, body.current, e.clientX, e.clientY);
    const hit = i < 0 ? null : placed.find((p) => p.at && p.at.start <= i && i < p.at.end);
    if (hit) { setOpenId(hit.highlight.id); return; }
    const touch = lastPointer.current === 'touch' || matchMedia('(pointer: coarse)').matches;
    if (!touch || i < 0 || readOnly) { setOpenId(null); return; }
    const k = sentenceAt(sentences, i);
    if (k < 0) return;
    const [s, end] = sentences[k];
    // Tapping the sentence after the open highlight extends it.
    if (open?.at && sentenceAt(sentences, open.at.end - 1) + 1 === k) save(open.at.start, end, open.highlight);
    else save(s, end);
  }, [model, body, placed, sentences, open, readOnly, save]);

  const onPointerDown = useCallback((e: React.PointerEvent) => { lastPointer.current = e.pointerType; }, []);

  /** Where the open highlight is on screen, so the tray can keep it in view. */
  const openRect = useCallback((): DOMRect | null => (open?.at && model ? rangeOf(model, open.at.start, open.at.end).getBoundingClientRect() : null), [open, model]);

  return {
    placed,
    lost: placed.filter((p) => !p.at).length,
    selecting: !!selection,
    open,
    toolSpot: readOnly || !selection ? null : selection.spot,
    announce,
    highlightSelection,
    removeOpen,
    keep,
    setDimension,
    setSubject,
    link,
    /** The article's wiki links, for the passage's candidates. */
    links: model?.links ?? NO_LINKS,
    openRect,
    readOnly: !!readOnly,
    onTextClick,
    onPointerDown,
  };
}
