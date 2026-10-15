import { useState } from 'react';
import { formatYear } from '../../model/dates';
import { useDoc } from '../DocContext';
import type { Nav } from '../nav';
import { titleOf } from '../util';

type Tab = 'notes' | 'sources' | 'trends';

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

  return (
    <section data-testid="library">
      <h2>Library</h2>
      <div className="segmented" role="tablist" style={{ marginBottom: 10 }}>
        <button type="button" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>Notes ({doc.notes.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'sources'} onClick={() => setTab('sources')}>Sources ({doc.sources.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'trends'} onClick={() => setTab('trends')}>Trends ({doc.series.length})</button>
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
                  <small>{s.points.length} points, {formatYear(Math.round(s.points[0]?.x ?? 0))} to {formatYear(Math.round(s.points.at(-1)?.x ?? 0))}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
