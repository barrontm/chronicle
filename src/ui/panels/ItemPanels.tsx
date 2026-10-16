import { useState } from 'react';
import { describeRelation, newId, notesFor, relationsFor, remove, upsert, RELATION_TYPES } from '../../model/doc';
import { compareHistDate, formatRange, formatHistDate, toDecimalYear } from '../../model/dates';
import type { ItemDraft } from '../../media/wikipedia';
import type { Citation, HistDate, ItemKind, MediaRef, Place, Relation, RelationType, Source, TimelineItem } from '../../model/types';
import { useDoc } from '../DocContext';
import { CitationsEditor, DateField, Field, RecordPicker } from '../fields';
import { ImagePicker } from '../ImagePicker';
import type { Nav } from '../nav';
import { formatCitation, titleOf } from '../util';
import { InfluenceSuggestions } from './Influences';
import { QuickSource } from './SourcePanels';

const KIND_LABEL: Record<ItemKind, string> = { event: 'Event', span: 'Period', person: 'Person' };
const PLACE_ROLE: Record<NonNullable<Place['role']>, string> = { site: '', born: 'Born in ', died: 'Died in ' };

function placeLabel(pl: Place): string {
  const coords = `${Math.abs(pl.lat).toFixed(2)}°${pl.lat >= 0 ? 'N' : 'S'}, ${Math.abs(pl.lon).toFixed(2)}°${pl.lon >= 0 ? 'E' : 'W'}`;
  return `${PLACE_ROLE[pl.role ?? 'site']}${pl.name ? `${pl.name} (${coords})` : coords}`;
}

/** Quoted reference text, kept visibly apart from Bob's own writing. */
function Excerpt({ excerpt, source }: { excerpt: { text: string }; source?: Source }) {
  return (
    <blockquote className="excerpt" data-testid="excerpt">
      <p>{excerpt.text}</p>
      <footer>
        From {source?.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.publisher ?? source.title}</a> : (source?.publisher ?? source?.title ?? 'a source')}
        {source?.accessed && <>, read {source.accessed}</>}
      </footer>
    </blockquote>
  );
}

export function Figure({ m }: { m: MediaRef }) {
  const { mediaUrl } = useDoc();
  const src = mediaUrl(m);
  const credit = [m.credit, m.license].filter(Boolean).join(', ');
  return (
    <figure className="figure">
      {src ? <img src={src} alt={m.caption ?? ''} /> : <div className="notice">Picture not available on this device yet.</div>}
      {(m.caption || credit) && (
        <figcaption>
          {m.caption}
          {credit && <> {m.caption ? '— ' : ''}{credit}</>}
          {m.sourceUrl && <> (<a href={m.sourceUrl} target="_blank" rel="noreferrer">source</a>)</>}
        </figcaption>
      )}
    </figure>
  );
}

export function ItemView({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const item = doc.items.find((i) => i.id === id);
  if (!item) return <div className="notice">This entry was deleted.</div>;
  const cat = doc.categories.find((c) => c.id === item.categoryId);
  const notes = notesFor(doc, id);
  const { outgoing, incoming } = relationsFor(doc, id);
  const sources = new Map(doc.sources.map((s) => [s.id, s]));
  const years = item.end ? Math.round(compareHistDate(item.end, item.start)) : null;
  const territories = doc.territories.filter((t) => t.itemId === id);
  const flows = doc.flows.filter((f) => f.itemId === id);

  return (
    <article data-testid="item-view">
      {item.media?.map((m) => <Figure key={m.id} m={m} />)}
      <h2>{item.title}</h2>
      <div className="meta">
        <span style={{ '--c': cat?.color } as React.CSSProperties}><span className="swatch" />{cat?.label}</span>
        <span>{KIND_LABEL[item.kind]}</span>
        <span>{item.kind === 'person' && !item.end ? `Born ${formatHistDate(item.start)}` : formatRange(item.start, item.end)}</span>
        {years !== null && years > 0 && <span>{years} {years === 1 ? 'year' : 'years'}{item.kind === 'person' ? ' old' : ''}</span>}
      </div>
      {item.description && <p className="prose">{item.description}</p>}
      {item.places && item.places.length > 0 && <p className="meta" data-testid="item-places">{item.places.map(placeLabel).join(' · ')}</p>}
      {item.excerpt && <Excerpt excerpt={item.excerpt} source={sources.get(item.excerpt.sourceId)} />}
      {(territories.length > 0 || flows.length > 0) && (
        <>
          <h3>On the map</h3>
          <ul className="linklist">
            {territories.map((t) => <li key={t.id}><button onClick={() => nav.open({ type: 'territory', id: t.id })}><strong>{t.title}</strong><small>Territory, {t.snapshots.length} {t.snapshots.length === 1 ? 'map' : 'maps'}</small></button></li>)}
            {flows.map((f) => <li key={f.id}><button onClick={() => nav.open({ type: 'flow', id: f.id })}><strong>{f.title}</strong><small>Migration, {f.routes.length} {f.routes.length === 1 ? 'route' : 'routes'}</small></button></li>)}
          </ul>
        </>
      )}

      <h3>Notes</h3>
      <ul className="linklist">
        {notes.map((n) => (
          <li key={n.id}><button onClick={() => nav.open({ type: 'note', id: n.id })}><strong>{n.title}</strong><small>{n.body.slice(0, 90)}{n.body.length > 90 ? '…' : ''}</small></button></li>
        ))}
      </ul>
      <button className="btn small" onClick={() => nav.open({ type: 'new-note', linkedIds: [id] })}>Write a note</button>

      {(outgoing.length > 0 || incoming.length > 0) && (
        <>
          <h3>Connections</h3>
          <ul className="linklist">
            {[...outgoing.map((r) => ({ r, dir: 'out' as const, other: r.toId })), ...incoming.map((r) => ({ r, dir: 'in' as const, other: r.fromId }))].map(({ r, dir, other }) => (
              <li key={r.id}>
                <button onClick={() => nav.open({ type: 'item', id: other })}>
                  <small>{describeRelation(r.type, dir)}</small>
                  <strong>{titleOf(doc, other) ?? 'Missing entry'}</strong>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {item.kind === 'person' && item.wikidataId && <InfluenceSuggestions key={item.id} item={item} nav={nav} />}

      {item.citations && item.citations.length > 0 && (
        <>
          <h3>Sources</h3>
          <ul className="linklist">
            {item.citations.map((c, i) => (
              <li key={i}><button className="citation" onClick={() => nav.open({ type: 'source', id: c.sourceId })}>{formatCitation(sources.get(c.sourceId), c)}</button></li>
            ))}
          </ul>
        </>
      )}

      <div className="actions">
        <button className="btn primary" onClick={() => nav.replace({ type: 'item', id, edit: true })}>Edit</button>
        {(item.places?.length || territories.length > 0 || flows.length > 0) && <button className="btn" onClick={() => nav.showOnMap(toDecimalYear(item.start))}>Show on map</button>}
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(`Delete “${item.title}”? Its connections are removed; notes about it are kept.`)) {
              update((d) => remove(d, 'items', id));
              nav.close();
            }
          }}
        >Delete</button>
      </div>
    </article>
  );
}

/** Connection choices phrased from this item's point of view. */
type ConnectionChoice = { label: string; type: RelationType; dir: 'out' | 'in' };
const CONNECTION_CHOICES: ConnectionChoice[] = RELATION_TYPES.flatMap((type): ConnectionChoice[] =>
  type === 'related'
    ? [{ label: describeRelation(type, 'out'), type, dir: 'out' as const }]
    : [{ label: describeRelation(type, 'out'), type, dir: 'out' as const }, { label: describeRelation(type, 'in'), type, dir: 'in' as const }],
);

export function ItemEditor({ id, init, draft: prefill, nav }: {
  id: string | null;
  init?: { year?: number; categoryId?: string; kind?: ItemKind };
  /** A prefilled, unsaved entry (e.g. from Wikipedia) and the new sources it cites. */
  draft?: ItemDraft;
  nav: Nav;
}) {
  const { doc: savedDoc, update } = useDoc();
  const newSources = prefill?.newSources ?? [];
  // Let the citation pickers see sources that will be saved along with the entry.
  const doc = newSources.length ? { ...savedDoc, sources: [...savedDoc.sources, ...newSources] } : savedDoc;
  const existing = id ? doc.items.find((i) => i.id === id) : undefined;
  const [draft, setDraft] = useState<TimelineItem>(() => existing ?? prefill?.item ?? {
    id: newId('i'),
    kind: init?.kind ?? 'event',
    title: '',
    start: init?.year !== undefined ? { y: init.year } : (undefined as unknown as HistDate),
    categoryId: init?.categoryId ?? doc.categories[0]?.id ?? '',
    updatedAt: 0,
  });
  const [valid, setValid] = useState({ start: !!draft.start, end: true });
  const initialRelations = existing ? doc.relations.filter((r) => r.fromId === draft.id || r.toId === draft.id) : [];
  // A Wikipedia draft arrives with influences on people already on the timeline.
  const [relations, setRelations] = useState<Relation[]>(existing ? initialRelations : prefill?.relations ?? []);
  const [choice, setChoice] = useState(0);
  const [picking, setPicking] = useState(false);
  const [quickSource, setQuickSource] = useState(false);

  const set = <K extends keyof TimelineItem>(k: K, v: TimelineItem[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setExcerpt = (e: TimelineItem['excerpt']) => setDraft((d) => {
    if (e) return { ...d, excerpt: e };
    const { excerpt: _excerpt, ...rest } = d;
    return rest;
  });
  const needsEnd = draft.kind === 'span';
  const endBeforeStart = draft.start && draft.end && compareHistDate(draft.end, draft.start) < 0;
  const canSave = draft.title.trim() && valid.start && draft.start && valid.end && (!needsEnd || draft.end) && !endBeforeStart;

  const save = () => {
    const item: TimelineItem = { ...draft, title: draft.title.trim(), end: draft.kind === 'event' ? undefined : draft.end };
    const keep = new Set(relations.map((r) => r.id));
    const cited = new Set([...(item.citations ?? []).map((c) => c.sourceId), item.excerpt?.sourceId]);
    update((d) => {
      let next = d;
      for (const s of newSources) if (cited.has(s.id) && !next.sources.some((x) => x.id === s.id)) next = upsert(next, 'sources', s);
      next = upsert(next, 'items', item);
      for (const r of initialRelations) if (!keep.has(r.id)) next = remove(next, 'relations', r.id);
      for (const r of relations) if (!initialRelations.includes(r)) next = upsert(next, 'relations', r);
      return next;
    });
    nav.replace({ type: 'item', id: item.id });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canSave) save(); }} data-testid="item-editor">
      <h2>{existing ? 'Edit entry' : 'New entry'}</h2>
      <Field label="What is it?">
        <div className="segmented" role="group">
          {(['event', 'span', 'person'] as ItemKind[]).map((k) => (
            <button type="button" key={k} aria-pressed={draft.kind === k} onClick={() => set('kind', k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
      </Field>
      <Field label={draft.kind === 'person' ? 'Name' : 'Title'}>
        <input value={draft.title} onChange={(e) => set('title', e.target.value)} autoFocus required placeholder={draft.kind === 'person' ? 'Hypatia' : draft.kind === 'span' ? 'Thirty Years’ War' : 'Battle of Marathon'} />
      </Field>
      <Field label="Category">
        <select value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <div className="row">
        <DateField
          label={draft.kind === 'person' ? 'Born' : draft.kind === 'span' ? 'From' : 'Date'}
          value={draft.start}
          onChange={(d, ok) => { set('start', d as HistDate); setValid((v) => ({ ...v, start: ok })); }}
        />
        {draft.kind !== 'event' && (
          <DateField
            label={draft.kind === 'person' ? 'Died' : 'To'}
            value={draft.end}
            optional={draft.kind === 'person'}
            onChange={(d, ok) => { set('end', d); setValid((v) => ({ ...v, end: ok })); }}
          />
        )}
      </div>
      {endBeforeStart && <div className="notice bad">The end date is before the start date.</div>}
      <Field label="Summary" hint="A sentence or two. Longer thinking goes in a note.">
        <textarea value={draft.description ?? ''} onChange={(e) => set('description', e.target.value || undefined)} rows={3} />
      </Field>

      {draft.excerpt && (
        <>
          <h3>From the source</h3>
          <Excerpt excerpt={draft.excerpt} source={doc.sources.find((x) => x.id === draft.excerpt!.sourceId)} />
          <button type="button" className="btn small quiet" onClick={() => setExcerpt(undefined)}>Remove quote</button>
        </>
      )}

      {draft.places && draft.places.length > 0 && (
        <>
          <h3>Places</h3>
          <div className="editor-list">
            {draft.places.map((pl, i) => (
              <div className="editor-row" key={i}>
                <span className="grow">{placeLabel(pl)}</span>
                <button type="button" className="btn small quiet" onClick={() => set('places', draft.places!.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Pictures</h3>
      <div className="thumbs">
        {draft.media?.map((m) => <Thumb key={m.id} m={m} onRemove={() => set('media', draft.media!.filter((x) => x.id !== m.id))} />)}
      </div>
      <button type="button" className="btn small" onClick={() => setPicking(true)}>Add a picture</button>
      <ImagePicker open={picking} initialQuery={draft.title} onClose={() => setPicking(false)} onAdd={(m) => set('media', [...(draft.media ?? []), m])} />

      <h3>Connections</h3>
      <div className="editor-list">
        {relations.map((r) => {
          const dir = r.fromId === draft.id ? 'out' : 'in';
          const other = dir === 'out' ? r.toId : r.fromId;
          return (
            <div className="editor-row" key={r.id}>
              <span className="grow"><small style={{ color: 'var(--muted)' }}>{describeRelation(r.type, dir)}</small> {titleOf(doc, other) ?? 'Missing entry'}</span>
              <button type="button" className="btn small quiet" onClick={() => setRelations(relations.filter((x) => x.id !== r.id))}>Remove</button>
            </div>
          );
        })}
      </div>
      <div className="editor-row">
        <select className="input" style={{ width: 150 }} value={choice} onChange={(e) => setChoice(Number(e.target.value))} aria-label="Kind of connection">
          {CONNECTION_CHOICES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
        </select>
        <div className="grow">
          <RecordPicker
            doc={doc}
            exclude={[draft.id]}
            placeholder="…which entry?"
            onPick={(other) => {
              const c = CONNECTION_CHOICES[choice];
              const r: Relation = c.dir === 'out'
                ? { id: newId('r'), fromId: draft.id, toId: other, type: c.type, updatedAt: 0 }
                : { id: newId('r'), fromId: other, toId: draft.id, type: c.type, updatedAt: 0 };
              setRelations([...relations, r]);
            }}
          />
        </div>
      </div>

      <h3>Sources</h3>
      <CitationsEditor doc={doc} value={draft.citations ?? []} onChange={(c: Citation[]) => set('citations', c)} onNewSource={() => setQuickSource(true)} />
      {quickSource && <QuickSource onDone={(sourceId) => { setQuickSource(false); if (sourceId) set('citations', [...(draft.citations ?? []), { sourceId }]); }} />}

      <div className="actions">
        <button className="btn primary" disabled={!canSave}>{existing ? 'Save changes' : 'Add to timeline'}</button>
        <button type="button" className="btn" onClick={() => (existing ? nav.replace({ type: 'item', id: draft.id }) : nav.back())}>Cancel</button>
      </div>
    </form>
  );
}

function Thumb({ m, onRemove }: { m: MediaRef; onRemove: () => void }) {
  const { mediaUrl } = useDoc();
  return (
    <div className="thumb">
      <img src={mediaUrl(m, true)} alt={m.caption ?? ''} />
      <button type="button" className="btn small" onClick={onRemove} aria-label="Remove picture">×</button>
    </div>
  );
}
