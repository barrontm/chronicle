import { useState } from 'react';
import { newId, remove, upsert } from '../../model/doc';
import type { Note } from '../../model/types';
import { useDoc } from '../DocContext';
import { CitationsEditor, Field, RecordPicker } from '../fields';
import type { Nav } from '../nav';
import { formatCitation, titleOf } from '../util';
import { QuickSource } from './SourcePanels';

export function NoteView({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const n = doc.notes.find((x) => x.id === id);
  if (!n) return <div className="notice">This note was deleted.</div>;
  const sources = new Map(doc.sources.map((s) => [s.id, s]));
  const openLinked = (lid: string) =>
    doc.series.some((s) => s.id === lid) ? nav.open({ type: 'series', id: lid }) : nav.open({ type: 'item', id: lid });

  return (
    <article data-testid="note-view">
      <div className="crumb" style={{ color: 'var(--muted)', fontSize: 12 }}>Note</div>
      <h2>{n.title}</h2>
      {n.linkedIds.length > 0 && (
        <div className="meta" style={{ marginBottom: 8 }}>
          About:
          {n.linkedIds.map((lid) => (
            <button key={lid} className="btn small quiet" onClick={() => openLinked(lid)}>{titleOf(doc, lid) ?? 'Missing entry'}</button>
          ))}
        </div>
      )}
      <div className="prose">{n.body || <span style={{ color: 'var(--muted)' }}>Empty note.</span>}</div>
      {n.citations && n.citations.length > 0 && (
        <>
          <h3>Sources</h3>
          <ul className="linklist">
            {n.citations.map((c, i) => (
              <li key={i}><button className="citation" onClick={() => nav.open({ type: 'source', id: c.sourceId })}>{formatCitation(sources.get(c.sourceId), c)}</button></li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button className="btn primary" onClick={() => nav.replace({ type: 'note', id, edit: true })}>Edit</button>
        <button className="btn danger" onClick={() => {
          if (confirm(`Delete the note “${n.title}”?`)) {
            update((d) => remove(d, 'notes', id));
            nav.back();
          }
        }}>Delete</button>
      </div>
    </article>
  );
}

export function NoteEditor({ id, linkedIds, nav }: { id: string | null; linkedIds?: string[]; nav: Nav }) {
  const { doc, update } = useDoc();
  const existing = id ? doc.notes.find((n) => n.id === id) : undefined;
  const [d, setD] = useState<Note>(existing ?? { id: newId('n'), title: '', body: '', linkedIds: linkedIds ?? [], updatedAt: 0 });
  const [quickSource, setQuickSource] = useState(false);
  const set = <K extends keyof Note>(k: K, v: Note[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <form data-testid="note-editor" onSubmit={(e) => {
      e.preventDefault();
      if (!d.title.trim()) return;
      update((doc) => upsert(doc, 'notes', { ...d, title: d.title.trim() }));
      nav.replace({ type: 'note', id: d.id });
    }}>
      <h2>{existing ? 'Edit note' : 'New note'}</h2>
      <Field label="Title"><input value={d.title} onChange={(e) => set('title', e.target.value)} required autoFocus placeholder="What was the Delian League for?" /></Field>
      <Field label="Note">
        <textarea value={d.body} onChange={(e) => set('body', e.target.value)} rows={12} placeholder="Write what you’ve learned in your own words." />
      </Field>

      <h3>About</h3>
      <div className="editor-list">
        {d.linkedIds.map((lid) => (
          <div className="editor-row" key={lid}>
            <span className="grow">{titleOf(doc, lid) ?? 'Missing entry'}</span>
            <button type="button" className="btn small quiet" onClick={() => set('linkedIds', d.linkedIds.filter((x) => x !== lid))}>Remove</button>
          </div>
        ))}
      </div>
      <RecordPicker doc={doc} includeSeries exclude={d.linkedIds} placeholder="Link to an entry or trend…" onPick={(lid) => set('linkedIds', [...d.linkedIds, lid])} />

      <h3>Sources</h3>
      <CitationsEditor doc={doc} value={d.citations ?? []} onChange={(c) => set('citations', c)} onNewSource={() => setQuickSource(true)} />
      {quickSource && <QuickSource onDone={(sid) => { setQuickSource(false); if (sid) set('citations', [...(d.citations ?? []), { sourceId: sid }]); }} />}

      <div className="actions">
        <button className="btn primary" disabled={!d.title.trim()}>{existing ? 'Save changes' : 'Save note'}</button>
        <button type="button" className="btn" onClick={() => (existing ? nav.replace({ type: 'note', id: d.id }) : nav.back())}>Cancel</button>
      </div>
    </form>
  );
}
