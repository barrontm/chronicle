import { useEffect, useRef, useState } from 'react';
import { articleCache } from '../../data/articleCache';
import { fetchArticle, type Article as ArticleData } from '../../media/article';
import { searchWikipedia, type WikiSearchResult } from '../../media/wikipedia';
import { Field } from '../fields';

/** A page Bob has opened in the reader. */
export interface ArticleRef {
  /** Page key for URLs, e.g. "Battle_of_Marathon". */
  key: string;
  title: string;
}

const OFFLINE_SEARCH = 'You’re offline. Searching Wikipedia needs a connection.';
const OFFLINE_READ = 'You’re offline, and this article isn’t saved on this device yet. Articles you’ve opened before can be read offline.';

/**
 * The reader column of the new layout: search Wikipedia and read the article
 * that's open. Opening and the reading trail are owned by the caller.
 */
export function ReaderPane({ article, searching, onOpen, onSearching, onBack, onShowMap }: {
  article: ArticleRef | null;
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
      {article && !searching && <Article key={article.key} article={article} onOpen={onOpen} />}
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

function Article({ article, onOpen }: { article: ArticleRef; onOpen: (a: ArticleRef) => void }) {
  const [data, setData] = useState<ArticleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

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
    if (!a) return;
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
      {error && <div className="notice bad" role="alert">{error}</div>}
      {!data && !error && <div className="notice" role="status">Opening…</div>}
      {/* Sanitized by sanitizeParsoid: an allowlist rebuild, so nothing active survives. */}
      {data && <div ref={body} className="reader-text" onClick={onClick} dangerouslySetInnerHTML={{ __html: data.html }} />}
      {data && (
        <p className="reader-credit">
          From <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(data.key)}`} target="_blank" rel="noreferrer">Wikipedia</a>, CC BY-SA
          {data.modified && <>, as edited on {new Date(data.modified).toLocaleDateString(undefined, { dateStyle: 'long' })}</>}.
        </p>
      )}
    </article>
  );
}
