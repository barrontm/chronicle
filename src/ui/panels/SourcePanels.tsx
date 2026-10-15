import { useState } from 'react';
import { newId, remove, upsert } from '../../model/doc';
import type { Source, SourceKind } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import type { Nav } from '../nav';

export const SOURCE_KINDS: { kind: SourceKind; label: string }[] = [
  { kind: 'book', label: 'Book' },
  { kind: 'article', label: 'Article' },
  { kind: 'chapter', label: 'Chapter' },
  { kind: 'lecture', label: 'Lecture or course' },
  { kind: 'video', label: 'Video or podcast' },
  { kind: 'web', label: 'Web page' },
  { kind: 'other', label: 'Other' },
];
const kindLabel = (k: SourceKind) => SOURCE_KINDS.find((x) => x.kind === k)?.label ?? k;

export function SourceView({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const s = doc.sources.find((x) => x.id === id);
  if (!s) return <div className="notice">This source was deleted.</div>;
  const citedByItems = doc.items.filter((i) => i.citations?.some((c) => c.sourceId === id));
  const citedByNotes = doc.notes.filter((n) => n.citations?.some((c) => c.sourceId === id));
  const loc = (cites?: { sourceId: string; locator?: string }[]) => cites?.filter((c) => c.sourceId === id && c.locator).map((c) => c.locator).join('; ');

  return (
    <article data-testid="source-view">
      <h2>{s.title}</h2>
      <div className="meta">
        <span>{kindLabel(s.kind)}</span>
        {s.authors && <span>{s.authors}</span>}
        {s.year && <span>{s.year}</span>}
        {s.publisher && <span>{s.publisher}</span>}
      </div>
      {s.url && <p><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></p>}
      {s.remarks && <p className="prose">{s.remarks}</p>}

      <h3>Cited by</h3>
      {citedByItems.length + citedByNotes.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>Nothing cites this yet. Add it to an entry or note under Sources.</p>}
      <ul className="linklist">
        {citedByItems.map((i) => (
          <li key={i.id}><button onClick={() => nav.open({ type: 'item', id: i.id })}><strong>{i.title}</strong>{loc(i.citations) && <small>{loc(i.citations)}</small>}</button></li>
        ))}
        {citedByNotes.map((n) => (
          <li key={n.id}><button onClick={() => nav.open({ type: 'note', id: n.id })}><small>Note</small><strong>{n.title}</strong>{loc(n.citations) && <small>{loc(n.citations)}</small>}</button></li>
        ))}
      </ul>

      <div className="actions">
        <button className="btn primary" onClick={() => nav.replace({ type: 'source', id, edit: true })}>Edit</button>
        <button className="btn danger" onClick={() => {
          if (confirm(`Delete “${s.title}”? Citations of it will be removed from your entries and notes.`)) {
            update((d) => remove(d, 'sources', id));
            nav.back();
          }
        }}>Delete</button>
      </div>
    </article>
  );
}

function blankSource(): Source {
  return { id: newId('s'), kind: 'book', title: '', updatedAt: 0 };
}

export function SourceEditor({ id, nav }: { id: string | null; nav: Nav }) {
  const { doc, update } = useDoc();
  const existing = id ? doc.sources.find((s) => s.id === id) : undefined;
  const [d, setD] = useState<Source>(existing ?? blankSource());
  const set = <K extends keyof Source>(k: K, v: Source[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <form data-testid="source-editor" onSubmit={(e) => {
      e.preventDefault();
      if (!d.title.trim()) return;
      update((doc) => upsert(doc, 'sources', { ...d, title: d.title.trim() }));
      nav.replace({ type: 'source', id: d.id });
    }}>
      <h2>{existing ? 'Edit source' : 'New source'}</h2>
      <SourceFields d={d} set={set} />
      <Field label="Your remarks" hint="What it’s good for, how reliable it is, what to read next.">
        <textarea value={d.remarks ?? ''} onChange={(e) => set('remarks', e.target.value || undefined)} rows={4} />
      </Field>
      <div className="actions">
        <button className="btn primary" disabled={!d.title.trim()}>{existing ? 'Save changes' : 'Add source'}</button>
        <button type="button" className="btn" onClick={() => (existing ? nav.replace({ type: 'source', id: d.id }) : nav.back())}>Cancel</button>
      </div>
    </form>
  );
}

function SourceFields({ d, set }: { d: Source; set: <K extends keyof Source>(k: K, v: Source[K]) => void }) {
  return (
    <>
      <Field label="Kind">
        <select value={d.kind} onChange={(e) => set('kind', e.target.value as SourceKind)}>
          {SOURCE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </Field>
      <Field label="Title"><input value={d.title} onChange={(e) => set('title', e.target.value)} required autoFocus /></Field>
      <div className="row">
        <Field label="Author(s)"><input value={d.authors ?? ''} onChange={(e) => set('authors', e.target.value || undefined)} /></Field>
        <Field label="Year"><input value={d.year ?? ''} onChange={(e) => set('year', e.target.value || undefined)} placeholder="2000" /></Field>
      </div>
      <Field label="Publisher or venue"><input value={d.publisher ?? ''} onChange={(e) => set('publisher', e.target.value || undefined)} /></Field>
      <Field label="Link"><input type="url" value={d.url ?? ''} onChange={(e) => set('url', e.target.value || undefined)} placeholder="https://…" /></Field>
    </>
  );
}

/** Small inline form for adding a source without leaving the entry you're editing. */
export function QuickSource({ onDone }: { onDone: (sourceId?: string) => void }) {
  const { update } = useDoc();
  const [d, setD] = useState<Source>(blankSource());
  const set = <K extends keyof Source>(k: K, v: Source[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <div className="notice" data-testid="quick-source" style={{ background: 'var(--bg)', marginTop: 8 }}>
      <SourceFields d={d} set={set} />
      <div className="editor-row">
        <button type="button" className="btn primary small" disabled={!d.title.trim()} onClick={() => {
          update((doc) => upsert(doc, 'sources', { ...d, title: d.title.trim() }));
          onDone(d.id);
        }}>Add and cite</button>
        <button type="button" className="btn small" onClick={() => onDone()}>Cancel</button>
      </div>
    </div>
  );
}
