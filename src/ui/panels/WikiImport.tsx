import { useRef, useState } from 'react';
import { draftFromWikipedia, searchWikipedia, type WikiSearchResult } from '../../media/wikipedia';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import type { Nav } from '../nav';

const OFFLINE = 'You’re offline. Adding from Wikipedia needs a connection; you can still add an entry by hand.';

/**
 * Search Wikipedia, pick a page, and get a prefilled entry to check before
 * saving: dates and kind from Wikidata, a place, a picture with its credit,
 * the intro as a quoted excerpt, and the page as a cited source.
 */
export function WikiImport({ nav }: { nav: Nav }) {
  const { doc } = useDoc();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<WikiSearchResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async <T,>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(label);
    setError(null);
    setDuplicate(null);
    try {
      return await fn(ctl.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(navigator.onLine ? (e as Error).message : OFFLINE);
      return undefined;
    } finally {
      if (abort.current === ctl) setBusy(null);
    }
  };

  const search = async () => {
    if (!q.trim()) return;
    if (!navigator.onLine) { setError(OFFLINE); return; }
    const r = await run('Searching…', (signal) => searchWikipedia(q.trim(), signal));
    if (r) setResults(r);
  };

  const pick = async (r: WikiSearchResult) => {
    const out = await run(`Reading “${r.title}”…`, (signal) => draftFromWikipedia(r.key, {
      existingItems: doc.items,
      existingSources: doc.sources,
      categoryId: doc.categories[0]?.id ?? '',
      today: new Date().toISOString().slice(0, 10),
      signal,
    }));
    if (!out) return;
    if ('duplicateOf' in out) setDuplicate({ id: out.duplicateOf, title: doc.items.find((i) => i.id === out.duplicateOf)?.title ?? r.title });
    else nav.open({ type: 'new-item', draft: out.draft });
  };

  return (
    <div data-testid="wiki-import">
      <h2>Add from Wikipedia</h2>
      <p className="lede">Pick a page and you’ll get an entry filled in from Wikipedia and Wikidata. Check it and change anything before you add it.</p>
      <form className="editor-row" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void search(); }}>
        <div className="grow">
          <Field label="Search Wikipedia">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Battle of Marathon, Ada Lovelace…" autoFocus />
          </Field>
        </div>
        <button className="btn primary" disabled={!q.trim() || !!busy}>Search</button>
      </form>

      {busy && <div className="notice" role="status">{busy}</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {duplicate && (
        <div className="notice" role="status">
          “{duplicate.title}” is already on your timeline.{' '}
          <button className="btn small" onClick={() => nav.open({ type: 'item', id: duplicate.id })}>Open it</button>
        </div>
      )}

      {results && results.length === 0 && <div className="notice">No pages match “{q}”. Try other words.</div>}
      {results && results.length > 0 && (
        <ul className="linklist wiki-results" data-testid="wiki-results">
          {results.map((r) => (
            <li key={r.key}>
              <button onClick={() => void pick(r)} disabled={!!busy}>
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
