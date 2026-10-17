import { useState } from 'react';
import { formatYear } from '../../model/dates';
import { useDoc } from '../DocContext';
import type { Nav } from '../nav';
import { routeYears } from '../mapData';
import { DIMENSION_LABEL, titleOf } from '../util';

type Tab = 'notes' | 'highlights' | 'sources' | 'trends' | 'territories' | 'migration';

/** Everything that isn't on the timeline itself: your notes, your bibliography, your trends. */
export function Library({ tab: initial, nav }: { tab: Tab; nav: Nav }) {
  const { doc } = useDoc();
  const [tab, setTab] = useState<Tab>(initial);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const match = (...fields: (string | undefined)[]) => !needle || fields.some((f) => f?.toLowerCase().includes(needle));

  const notes = [...doc.notes].filter((n) => match(n.title, n.body)).sort((a, b) => b.updatedAt - a.updatedAt);
  const sources = [...doc.sources].filter((s) => match(s.title, s.authors, s.remarks)).sort((a, b) => (a.authors ?? a.title).localeCompare(b.authors ?? b.title));
  const trends = doc.series.filter((s) => match(s.title, s.unit));
  const territories = doc.territories.filter((t) => match(t.title)).sort((a, b) => a.title.localeCompare(b.title));
  const flows = doc.flows.filter((f) => match(f.title, f.note)).sort((a, b) => a.title.localeCompare(b.title));
  // Highlights by source, newest source first; a source matches if it or any of its highlights does.
  const bySource = doc.sources
    .map((s) => ({ source: s, highlights: doc.highlights.filter((h) => h.sourceId === s.id && match(h.text, s.title)) }))
    .filter((g) => g.highlights.length)
    .sort((a, b) => Math.max(...b.highlights.map((h) => h.updatedAt)) - Math.max(...a.highlights.map((h) => h.updatedAt)));

  return (
    <section data-testid="library">
      <h2>Library</h2>
      <div className="segmented" role="tablist" style={{ marginBottom: 10 }}>
        <button type="button" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>Notes ({doc.notes.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'highlights'} onClick={() => setTab('highlights')}>Highlights ({doc.highlights.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'sources'} onClick={() => setTab('sources')}>Sources ({doc.sources.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'trends'} onClick={() => setTab('trends')}>Trends ({doc.series.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'territories'} onClick={() => setTab('territories')}>Territories ({doc.territories.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'migration'} onClick={() => setTab('migration')}>Migration ({doc.flows.length})</button>
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}…`} aria-label={`Search ${tab}`} style={{ marginBottom: 8 }} />

      {tab === 'notes' && (
        <>
          <button className="btn small" onClick={() => nav.open({ type: 'new-note', linkedIds: [] })}>New note</button>
          {doc.notes.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>Notes are your own write-ups. Open any entry and choose “Write a note” to start one about it.</p>}
          <ul className="linklist">
            {notes.map((n) => (
              <li key={n.id}>
                <button onClick={() => nav.open({ type: 'note', id: n.id })}>
                  <strong>{n.title}</strong>
                  <small>{n.linkedIds.map((id) => titleOf(doc, id)).filter(Boolean).join(', ') || 'Not linked to anything'}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'highlights' && (
        <>
          {doc.highlights.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>Passages you highlight while reading show up here, under the article or book they came from.</p>}
          {bySource.map(({ source, highlights }) => (
            <section key={source.id} className="highlight-group" data-testid="highlight-group">
              <h3><button className="citation" onClick={() => nav.open({ type: 'source', id: source.id })}>{source.title}</button></h3>
              <ul className="linklist">
                {highlights.map((h) => {
                  const on = h.usedBy.flatMap((id) => { const t = titleOf(doc, id); return t ? [{ id, t }] : []; });
                  const item = on.find((o) => doc.items.some((i) => i.id === o.id));
                  return (
                    <li key={h.id}>
                      <button onClick={() => nav.open(item ? { type: 'item', id: item.id } : { type: 'source', id: source.id })}>
                        <strong className="quote">“{h.text}”</strong>
                        <small>
                          {[h.dimension && DIMENSION_LABEL[h.dimension], on.length ? `on ${on.map((o) => o.t).join(', ')}` : 'kept as a highlight'].filter(Boolean).join(' · ')}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {tab === 'sources' && (
        <>
          <button className="btn small" onClick={() => nav.open({ type: 'new-source' })}>New source</button>
          {doc.sources.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>Your bibliography: books, articles, lectures and sites you’ve learned from.</p>}
          <ul className="linklist">
            {sources.map((s) => (
              <li key={s.id}>
                <button onClick={() => nav.open({ type: 'source', id: s.id })}>
                  <strong className="citation">{s.title}</strong>
                  <small>{[s.authors, s.year].filter(Boolean).join(', ')}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'trends' && (
        <>
          <button className="btn small" onClick={() => nav.open({ type: 'series', id: null })}>New trend</button>
          <ul className="linklist">
            {trends.map((s) => (
              <li key={s.id}>
                <button onClick={() => nav.open({ type: 'series', id: s.id })}>
                  <strong>{s.title}</strong>
                  <small>
                    {s.points.length > 0 && `${s.points.length} points, ${formatYear(Math.round(s.points[0].x))} to ${formatYear(Math.round(s.points.at(-1)!.x))}`}
                    {s.points.length > 0 && s.regions && ' · '}
                    {s.regions && `map values for ${Object.keys(s.regions).length} ${Object.keys(s.regions).length === 1 ? 'place' : 'places'}`}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === 'territories' && (
        <>
          {doc.territories.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>Territories are borders you’ve brought onto the map, like the Roman Empire across the centuries. Add one from the map’s “Add a territory” button.</p>}
          <ul className="linklist">
            {territories.map((t) => (
              <li key={t.id}>
                <button onClick={() => nav.open({ type: 'territory', id: t.id })}>
                  <strong>{t.title}</strong>
                  <small>{t.snapshots.length} {t.snapshots.length === 1 ? 'map' : 'maps'}{t.snapshots[0] ? `, from ${formatYear(t.snapshots[0].from.y)}` : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === 'migration' && (
        <>
          <button className="btn small" onClick={() => nav.open({ type: 'new-flow' })}>New migration</button>
          {doc.flows.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>Migrations are people moving between places, like the Irish leaving during the famine. They show on the map as arrows.</p>}
          <ul className="linklist">
            {flows.map((f) => (
              <li key={f.id}>
                <button onClick={() => nav.open({ type: 'flow', id: f.id })}>
                  <strong>{f.title}</strong>
                  <small>{f.routes.length} {f.routes.length === 1 ? 'route' : 'routes'}{f.routes[0] ? `, ${routeYears(f.routes.flatMap((r) => r.points))}` : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
