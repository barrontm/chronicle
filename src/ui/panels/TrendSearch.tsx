import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { parseHistDate, toDecimalYear } from '../../model/dates';
import { Field } from '../fields';
import { SOURCE_NAMES, searchTrends, yearsLabel, type TrendIndex, type TrendRef } from '../../data/trendCatalog';

let indexPromise: Promise<TrendIndex> | null = null;

/** The bundled catalogue, loaded once (precached by the service worker, so it works offline). */
export function loadTrendIndex(): Promise<TrendIndex> {
  indexPromise ??= fetch(`${import.meta.env.BASE_URL}data/trend-index.json`).then((res) => {
    if (!res.ok) throw new Error(`The list of trends didn’t load (${res.status}).`);
    return res.json() as Promise<TrendIndex>;
  });
  indexPromise.catch(() => { indexPromise = null; });
  return indexPromise;
}

/** Search Our World in Data and the World Bank by name; `onPick` fetches the chosen dataset. */
export function TrendSearch({ busyId, onPick }: { busyId: string | null; onPick: (r: TrendRef, index: TrendIndex) => void }) {
  const [index, setIndex] = useState<TrendIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'' | TrendRef['s']>('');
  const [before, setBefore] = useState('');
  const deferred = useDeferredValue(query);

  useEffect(() => {
    loadTrendIndex().then(setIndex, (e: Error) => setError(e.message));
  }, []);

  const beforeDate = before.trim() ? parseHistDate(before) : null;
  const beforeYear = beforeDate ? toDecimalYear(beforeDate) : undefined;
  const results = useMemo(
    () => (index ? searchTrends(index, deferred, { source: source || undefined, before: beforeYear }) : []),
    [index, deferred, source, beforeYear],
  );

  return (
    <div className="trend-search" data-testid="trend-search">
      <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Population, GDP per capita, migrants, literacy…" aria-label="Search trends" />
      <div className="row">
        <Field label="From">
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="">All sources</option>
            <option value="owid">{SOURCE_NAMES.owid}</option>
            <option value="wb">{SOURCE_NAMES.wb}</option>
          </select>
        </Field>
        <Field label="Goes back before">
          <input value={before} onChange={(e) => setBefore(e.target.value)} placeholder="1800, 500 BCE…" />
        </Field>
      </div>
      {before.trim() && !beforeDate && <small className="hint">“{before}” isn’t a year.</small>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {!index && !error && <small className="hint">Loading the list of trends…</small>}
      {index && deferred.trim() && results.length === 0 && <small className="hint">No trends match. Try fewer or shorter words.</small>}
      {results.length > 0 && (
        <ul className="linklist trend-results" aria-label="Trends found">
          {results.map((r) => (
            <li key={`${r.s}:${r.id}`}>
              <button type="button" disabled={!!busyId} onClick={() => onPick(r, index!)} aria-busy={busyId === `${r.s}:${r.id}`}>
                <strong>{r.t}</strong>
                <small>
                  {SOURCE_NAMES[r.s]}{yearsLabel(r) && ` · ${yearsLabel(r)}`}{r.u && ` · ${r.u}`}
                  {busyId === `${r.s}:${r.id}` && ' · Fetching…'}
                </small>
                {r.d && <small className="trend-desc">{r.d}</small>}
                {r.c && <small>{r.c}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
