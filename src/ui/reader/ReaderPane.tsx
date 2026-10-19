import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftSet } from '../../ai/draft';
import { articleCache } from '../../data/articleCache';
import { fetchArticle, type Article as ArticleData } from '../../media/article';
import { draftFromWikipedia, searchWikipedia, type ItemDraft, type WikiSearchResult } from '../../media/wikipedia';
import { passageCandidates } from '../../model/passage';
import { KIND_LABEL, findInChronicle, subjectPartOf, subjectWhen } from '../../model/subjects';
import type { Highlight } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import { CaptureTray } from './CaptureTray';
import { HighlightTool, HighlightsForScreenReaders } from './HighlightTool';
import { InfoboxFold } from './Infobox';
import { useHighlighting } from './useHighlighting';
import { useSubject, useSubjects, type SubjectState } from './useSubject';

/** An entry or territory Bob already has, to open from the reader. */
export type RecordRef = { type: 'item' | 'territory'; id: string };

/** A page Bob has opened in the reader. */
export interface ArticleRef {
  /** Page key for URLs, e.g. "Battle_of_Marathon". */
  key: string;
  title: string;
}

const LOADING: SubjectState = { status: 'loading' };
const OFFLINE_SEARCH = 'You’re offline. Searching Wikipedia needs a connection.';
const OFFLINE_READ = 'You’re offline, and this article isn’t saved on this device yet. Articles you’ve opened before can be read offline.';
const OFFLINE_ADD = 'You’re offline. Adding to the map and timeline needs a connection; your highlight is saved.';

/**
 * The reader column of the reader layout: search Wikipedia and read the article
 * that's open. Opening and the reading trail are owned by the caller.
 */
export function ReaderPane({ article, searching, onOpen, onSearching, onBack, onShowMap, onOpenRecord, onDraft, onShowYear, onOpenDrafting }: {
  article: ArticleRef | null;
  /** Open what Bob already has for the article's subject. */
  onOpenRecord?: (r: RecordRef) => void;
  /** Open a prefilled entry for Bob to check and add. */
  onDraft?: (d: ItemDraft) => void;
  /** Move the map and timeline to a year (to show an entry Bob just accepted). */
  onShowYear?: (year: number) => void;
  /** Open Drafting with AI, where Bob sets his Anthropic key. */
  onOpenDrafting?: () => void;
  /** Go back along the reading trail, when there is somewhere to go. */
  onBack?: () => void;
  /** True while the "Open an article" search is showing. */
  searching: boolean;
  onOpen: (a: ArticleRef) => void;
  onSearching: (on: boolean) => void;
  /** Phone only: open the map and timeline sheet. */
  onShowMap?: () => void;
}) {
  // A new article starts at its top.
  const pane = useRef<HTMLElement>(null);
  useEffect(() => { pane.current?.scrollTo({ top: 0 }); }, [article?.key, searching]);

  return (
    <section ref={pane} className="reader" aria-label="Reader" data-testid="reader">
      {(onShowMap || (onBack && !searching)) && (
        <div className="reader-tools">
          {onBack && !searching && <button className="btn small quiet" onClick={onBack}>Back</button>}
          <span className="spacer" />
          {onShowMap && <button className="btn small" onClick={onShowMap}>Map</button>}
        </div>
      )}
      {(searching || !article) && <ArticleSearch hasArticle={!!article} onOpen={onOpen} onCancel={() => onSearching(false)} />}
      {article && !searching && <Article key={article.key} article={article} onOpen={onOpen} onOpenRecord={onOpenRecord} onDraft={onDraft} onShowYear={onShowYear} onOpenDrafting={onOpenDrafting} />}
    </section>
  );
}

function ArticleSearch({ hasArticle, onOpen, onCancel }: { hasArticle: boolean; onOpen: (a: ArticleRef) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<WikiSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const search = async () => {
    if (!q.trim()) return;
    if (!navigator.onLine) { setError(OFFLINE_SEARCH); return; }
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchWikipedia(q.trim(), ctl.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(navigator.onLine ? (e as Error).message : OFFLINE_SEARCH);
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  };

  return (
    <div className="reader-search" data-testid="article-search">
      {!hasArticle && (
        <>
          <h1 className="reader-title">Open an article</h1>
          <p className="lede">Read a Wikipedia article here. What you highlight becomes part of your timeline and map.</p>
        </>
      )}
      <form className="editor-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <div className="grow">
          <Field label="Search Wikipedia">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Peloponnesian War, Pericles…" autoFocus />
          </Field>
        </div>
        <button className="btn primary" disabled={!q.trim() || busy}>Search</button>
        {hasArticle && <button type="button" className="btn quiet" onClick={onCancel}>Back to the article</button>}
      </form>
      {busy && <div className="notice" role="status">Searching…</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {results && results.length === 0 && <div className="notice">No pages match “{q}”. Try other words.</div>}
      {results && results.length > 0 && (
        <ul className="linklist wiki-results" data-testid="article-results">
          {results.map((r) => (
            <li key={r.key}>
              <button onClick={() => onOpen({ key: r.key, title: r.title })}>
                {r.thumbUrl ? <img src={r.thumbUrl} alt="" /> : <span className="wiki-thumb-empty" />}
                <span>
                  <strong>{r.title}</strong>
                  {r.description && <small>{r.description}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Under the title: what the article is about (kind, dates, what it was part of) and whether Bob already has it. */
function SubjectLine({ state, onOpenRecord }: { state: SubjectState; onOpenRecord?: (r: RecordRef) => void }) {
  const { doc } = useDoc();
  if (state.status === 'offline') {
    return <p className="reader-sub" data-testid="article-subject">You’re offline. What this article is about will show when you’re back online.</p>;
  }
  if (state.status !== 'ready') return <p className="reader-sub" data-testid="article-subject" aria-busy={state.status === 'loading'} />;
  const s = state.subject;
  const item = findInChronicle(doc.items, s.qid);
  const territory = item ? undefined : findInChronicle(doc.territories, s.qid);
  const have = item ?? territory;
  const color = have && doc.categories.find((c) => c.id === have.categoryId)?.color;
  const partOf = subjectPartOf(s);
  const parts = [s.kind && KIND_LABEL[s.kind], subjectWhen(s), partOf && `part of ${partOf}`].filter(Boolean);
  return (
    <p className="reader-sub" data-testid="article-subject" data-kind={s.kind}>
      {parts.join(' · ')}
      {have && (
        <>
          {parts.length > 0 && ' · '}
          <button
            className="in-chronicle"
            style={color ? ({ '--c': color } as React.CSSProperties) : undefined}
            onClick={() => onOpenRecord?.({ type: item ? 'item' : 'territory', id: have.id })}
            disabled={!onOpenRecord}
          >
            Already in Chronicle
          </button>
        </>
      )}
    </p>
  );
}

function Article({ article, onOpen, onOpenRecord, onDraft, onShowYear, onOpenDrafting }: {
  article: ArticleRef;
  onOpen: (a: ArticleRef) => void;
  onOpenRecord?: (r: RecordRef) => void;
  onDraft?: (d: ItemDraft) => void;
  onShowYear?: (year: number) => void;
  onOpenDrafting?: () => void;
}) {
  const { doc } = useDoc();
  const [data, setData] = useState<ArticleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const subject = useSubject(article.key);
  const marks = useHighlighting(body, data, subject.status === 'ready' ? subject.subject.qid : undefined);
  // Once a highlight is open: what the pages its passage links are about (the article's own comes first).
  const at = marks.open?.at;
  const keys = useMemo(
    () => (at ? passageCandidates(article.key, marks.links, at.start, at.end) : []),
    [article.key, marks.links, at],
  );
  const subjects = useSubjects(keys.slice(1));
  const known: Record<string, SubjectState> = { ...subjects, [keys[0] ?? article.key]: subject };
  const candidates = keys.map((key) => ({ key, state: known[key] ?? LOADING }));

  /** A page as a prefilled entry, quoting this highlight and citing the article Bob read (or the entry he already has for it). */
  const draftPage = async (h: Highlight, key: string): Promise<ItemDraft | { duplicateOf: string }> => {
    if (!navigator.onLine) throw new Error(OFFLINE_ADD);
    let out;
    try {
      out = await draftFromWikipedia(key, {
        existingItems: doc.items,
        existingSources: doc.sources,
        categoryId: doc.categories[0]?.id ?? '',
        today: new Date().toISOString().slice(0, 10),
        subject: known[key]?.status === 'ready' ? known[key].subject : undefined,
      });
    } catch (e) {
      throw navigator.onLine ? e : new Error(OFFLINE_ADD);
    }
    if ('duplicateOf' in out) return out;
    const { draft } = out;
    // Cite the article Bob read (already a source), not the drafted page: that's where the highlight is.
    const page = new Set(draft.newSources.map((s) => s.id));
    const citations = draft.item.citations?.map((c) => (page.has(c.sourceId) ? { ...c, sourceId: h.sourceId } : c));
    return {
      ...draft,
      item: { ...draft.item, ...(citations ? { citations } : {}), ...(h.lanes?.length ? { lanes: h.lanes } : {}) },
      newSources: [],
      highlight: h,
      // The highlight is the evidence Bob read for what Wikidata connects.
      ...(draft.relations ? { relations: draft.relations.map((r) => ({ ...r, highlightIds: [h.id] })) } : {}),
    };
  };

  /** One page, opened in the editor to check before it's added. */
  const addPage = async (h: Highlight, key: string) => {
    const d = await draftPage(h, key);
    if ('duplicateOf' in d) onOpenRecord?.({ type: 'item', id: d.duplicateOf });
    else onDraft?.(d);
  };

  /** Ask Claude what the passage states that has no article of its own. The SDK loads only now. */
  const askClaude = async (h: Highlight, apiKey: string, signal: AbortSignal): Promise<DraftSet> => {
    if (!marks.text || !data) throw new Error('The article is still opening.');
    const { draftFromHighlight } = await import('../../ai/highlight');
    return draftFromHighlight({
      highlight: h,
      article: { key: article.key, title: data.title, text: marks.text },
      candidates: candidates.map((c) => ({ key: c.key, subject: c.state.status === 'ready' ? c.state.subject : undefined })),
      doc, apiKey, signal,
      today: new Date().toISOString().slice(0, 10),
    });
  };

  // The saved copy opens first, so rereading works offline; otherwise fetch it and keep it.
  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      const cached = await articleCache().get(article.key);
      if (ctl.signal.aborted) return;
      if (cached) { setData(cached); return; }
      if (!navigator.onLine) { setError(OFFLINE_READ); return; }
      try {
        const fresh = await fetchArticle(article.key, ctl.signal);
        setData(fresh);
        await articleCache().put(fresh);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(navigator.onLine ? (e as Error).message : OFFLINE_READ);
      }
    })();
    return () => ctl.abort();
  }, [article.key]);

  // Wiki links open in the reader; footnotes and same-page links scroll within it.
  const onClick = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = (e.target as Element).closest('a');
    if (!a) { marks.onTextClick(e); return; }
    const wiki = a.getAttribute('data-wiki');
    const local = a.getAttribute('data-fn') ?? (a.classList.contains('self') ? a.getAttribute('data-frag') : null);
    if (wiki) {
      e.preventDefault();
      onOpen({ key: wiki.replace(/ /g, '_'), title: wiki.replace(/_/g, ' ') });
    } else if (local) {
      e.preventDefault();
      body.current?.querySelector(`[id="${CSS.escape(local)}"]`)?.scrollIntoView({ block: 'start' });
    }
  };

  return (
    <article className="reader-article" data-testid="article" data-revision={data?.revisionId ?? undefined}>
      <h1 className="reader-title">{data?.title ?? article.title}</h1>
      <SubjectLine state={subject} onOpenRecord={onOpenRecord} />
      {error && <div className="notice bad" role="alert">{error}</div>}
      {!data && !error && <div className="notice" role="status">Opening…</div>}
      {/* Sanitized by sanitizeParsoid: an allowlist rebuild, so nothing active survives. */}
      {data && <div ref={body} className="reader-text" onClick={onClick} onPointerDown={marks.onPointerDown} dangerouslySetInnerHTML={{ __html: data.html }} />}
      {data && <InfoboxFold body={body} html={data.html} />}
      {data && <HighlightTool marks={marks} />}
      {data && <HighlightsForScreenReaders marks={marks} />}
      {marks.lost > 0 && (
        <p className="notice" data-testid="lost-highlights">
          {marks.lost === 1 ? 'One of your highlights' : `${marks.lost} of your highlights`} couldn’t be found in this version of the article. They’re still saved.
        </p>
      )}
      {data && (
        <p className="reader-credit">
          From <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(data.key)}`} target="_blank" rel="noreferrer">Wikipedia</a>, CC BY-SA
          {data.modified && <>, as edited on {new Date(data.modified).toLocaleDateString(undefined, { dateStyle: 'long' })}</>}.
        </p>
      )}
      {data && (
        <CaptureTray
          marks={marks} candidates={candidates} articleTitle={data.title}
          onAdd={addPage} onDraftPage={draftPage} onAsk={askClaude} onOpenRecord={onOpenRecord} onEdit={onDraft} onShowYear={onShowYear} onOpenDrafting={onOpenDrafting}
        />
      )}
    </article>
  );
}
