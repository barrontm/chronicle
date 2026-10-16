import { useEffect, useRef, useState } from 'react';
import { influencesOf, newId, upsert } from '../../model/doc';
import { draftFromWikipedia, suggestInfluences, type InfluenceSuggestion } from '../../media/wikipedia';
import type { TimelineItem } from '../../model/types';
import { useDoc } from '../DocContext';
import type { Nav } from '../nav';

const OFFLINE = 'You’re offline. Suggestions come from Wikipedia, so they need a connection.';

/**
 * Who influenced this person, and whom they influenced, according to Wikipedia
 * (Wikidata's "influenced by"). People already on the timeline connect in one
 * tap; the rest can be added from Wikipedia.
 */
export function InfluenceSuggestions({ item, nav }: { item: TimelineItem; nav: Nav }) {
  const { doc, update } = useDoc();
  const [found, setFound] = useState<InfluenceSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async <T,>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    if (!navigator.onLine) { setError(OFFLINE); return undefined; }
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(label);
    setError(null);
    try {
      return await fn(ctl.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(navigator.onLine ? (e as Error).message : OFFLINE);
      return undefined;
    } finally {
      if (abort.current === ctl) setBusy(null);
    }
  };

  const look = async () => {
    const out = await run('Asking Wikipedia…', (signal) => suggestInfluences(item.wikidataId!, doc.items, signal));
    if (out) setFound(out);
  };

  // Hide the ones already connected, so connecting one takes it off the list.
  const { by, on } = influencesOf(doc.relations, item.id);
  const open = (found ?? []).filter((s) => !s.existingId || !(s.direction === 'by' ? by : on).includes(s.existingId));

  const connect = (s: InfluenceSuggestion) => update((d) => upsert(d, 'relations', {
    id: newId('r'),
    fromId: s.direction === 'by' ? s.existingId! : item.id,
    toId: s.direction === 'by' ? item.id : s.existingId!,
    type: 'influenced',
    updatedAt: 0,
  }));

  const add = async (s: InfluenceSuggestion) => {
    const out = await run(`Reading “${s.label}”…`, (signal) => draftFromWikipedia(s.pageKey!, {
      existingItems: doc.items,
      existingSources: doc.sources,
      categoryId: item.categoryId,
      today: new Date().toISOString().slice(0, 10),
      signal,
    }));
    if (!out) return;
    nav.open('duplicateOf' in out ? { type: 'item', id: out.duplicateOf } : { type: 'new-item', draft: out.draft });
  };

  const group = (dir: 'by' | 'on', title: string) => {
    const list = open.filter((s) => s.direction === dir);
    if (!list.length) return null;
    return (
      <>
        <h4>{title}</h4>
        <ul className="suggestion-list">
          {list.map((s) => (
            <li key={`${dir}-${s.qid}`}>
              <span className="suggestion">
                <strong>{s.label}</strong>
                {s.existingId
                  ? <button className="btn small" onClick={() => connect(s)} disabled={!!busy}>Connect</button>
                  : s.pageKey && <button className="btn small quiet" onClick={() => void add(s)} disabled={!!busy}>Add from Wikipedia</button>}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  };

  return (
    <section data-testid="influence-suggestions">
      {found === null
        ? <button className="btn small" onClick={() => void look()} disabled={!!busy}>Suggest influences</button>
        : <h3>Influences on Wikipedia</h3>}
      {busy && <div className="notice" role="status">{busy}</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {found && found.length === 0 && <div className="notice">Wikipedia doesn’t list influences for {item.title}.</div>}
      {found && found.length > 0 && open.length === 0 && <div className="notice">All connected.</div>}
      {group('by', 'Influenced by')}
      {group('on', 'Influenced')}
    </section>
  );
}
