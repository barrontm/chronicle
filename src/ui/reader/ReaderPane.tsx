import { useEffect, useRef, useState } from 'react';
import { fetchSummary, searchWikipedia, type WikiSearchResult, type WikiSummary } from '../../media/wikipedia';
import { Field } from '../fields';

/** A page Bob has opened in the reader. */
export interface ArticleRef {
  /** Page key for URLs, e.g. "Battle_of_Marathon". */
  key: string;
  title: string;
}

const OFFLINE_SEARCH = 'You’re offline. Searching Wikipedia needs a connection.';
const OFFLINE_READ = 'You’re offline. This article needs a connection to open.';

/**
 * The reader column of the new layout: search Wikipedia and read the article
 * that's open. Opening and the reading trail are owned by the caller.
 */
export function ReaderPane({ article, searching, onOpen, onSearching, onShowMap }: {
  article: ArticleRef | null;
  /** True while the "Open an article" search is showing. */
  searching: boolean;
  onOpen: (a: ArticleRef) => void;
  onSearching: (on: boolean) => void;
  /** Phone only: open the map and timeline sheet. */
  onShowMap?: () => void;
}) {
  return (
    <section className="reader" aria-label="Reader" data-testid="reader">
      {onShowMap && (
        <div className="reader-tools">
          <button className="btn small" onClick={onShowMap}>Map</button>
        </div>
      )}
      {(searching || !article) && <ArticleSearch hasArticle={!!article} onOpen={onOpen} onCancel={() => onSearching(false)} />}
      {article && !searching && <Article key={article.key} article={article} />}
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

function Article({ article }: { article: ArticleRef }) {
  const [summary, setSummary] = useState<WikiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.onLine) { setError(OFFLINE_READ); return; }
    const ctl = new AbortController();
    fetchSummary(article.key, ctl.signal).then(setSummary, (e: Error) => {
      if (e.name !== 'AbortError') setError(navigator.onLine ? e.message : OFFLINE_READ);
    });
    return () => ctl.abort();
  }, [article.key]);

  return (
    <article className="reader-article" data-testid="article">
      <h1 className="reader-title">{summary?.title ?? article.title}</h1>
      {summary?.description && <p className="reader-sub">{summary.description}</p>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {!summary && !error && <div className="notice" role="status">Opening…</div>}
      {summary?.extract && <div className="reader-text"><p>{summary.extract}</p></div>}
      {summary && <p className="reader-credit">From <a href={summary.pageUrl} target="_blank" rel="noreferrer">Wikipedia</a>, CC BY-SA.</p>}
    </article>
  );
}
