import { useMemo, useState } from 'react';
import { describeEffect, describeRelation, effectWords, laneInfluence, remove, upsert } from '../../model/doc';
import { entryLanes } from '../../model/lanes';
import type { Highlight, Relation } from '../../model/types';
import { useDoc } from '../DocContext';
import type { Nav } from '../nav';
import { LANE_LABEL, PIGMENT, titleOf } from '../util';
import { Excerpt } from './ItemPanels';

/** The Wikipedia article a source is, as the reader opens it. */
function articleOf(url: string | undefined): { key: string; title: string } | undefined {
  const m = url?.match(/wikipedia\.org\/wiki\/([^?#]+)/);
  if (!m) return undefined;
  const key = decodeURIComponent(m[1]);
  return { key, title: key.replace(/_/g, ' ') };
}

/** A lane's square and name. */
const LaneMark = ({ lane }: { lane: keyof typeof LANE_LABEL }) => (
  <span style={{ '--c': `var(--pig-${PIGMENT[lane]})` } as React.CSSProperties}><span className="swatch" />{LANE_LABEL[lane]}</span>
);

/**
 * A connection: both lanes, "Decelean War weakened Athenian silver “owls”", Bob's note, then the
 * highlights that are its evidence, each one tap from the reader (docs/design.md, Influences between lanes).
 */
export function RelationView({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const r = doc.relations.find((x) => x.id === id);
  const lanes = useMemo(() => entryLanes(doc.items, doc.highlights), [doc.items, doc.highlights]);
  if (!r) return <div className="notice">This connection was deleted.</div>;
  const inf = laneInfluence(r, lanes);
  const evidence = (r.highlightIds ?? []).flatMap((hid) => doc.highlights.filter((h) => h.id === hid));
  const end = (eid: string) => <button type="button" className="linkish" onClick={() => nav.open({ type: 'item', id: eid })}>{titleOf(doc, eid) ?? 'Missing entry'}</button>;

  return (
    <article data-testid="relation-view">
      <div className="meta">
        {inf ? <><LaneMark lane={inf.from} /><span aria-hidden>→</span><LaneMark lane={inf.to} /></> : <span>Connection</span>}
      </div>
      <h2 className="relation-title">{end(r.fromId)} <em>{describeEffect(r, 'out').toLowerCase()}</em> {end(r.toId)}</h2>
      {r.note && <p className="prose">{r.note}</p>}
      <h3>Evidence</h3>
      {evidence.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>No highlights yet. Pick the passages that show this.</p>}
      {evidence.map((h) => {
        const source = doc.sources.find((s) => s.id === h.sourceId);
        const article = articleOf(source?.url);
        return (
          <div key={h.id} data-testid="evidence">
            <Excerpt excerpt={h} source={source} />
            {article && <button type="button" className="btn small" onClick={() => nav.read(article)}>Open in the reader</button>}
          </div>
        );
      })}
      <div className="actions">
        <button className="btn primary" onClick={() => nav.replace({ type: 'relation', id, edit: true })}>Edit</button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Delete this connection? Its highlights are kept.')) {
              update((d) => remove(d, 'relations', id));
              nav.back();
            }
          }}
        >Delete</button>
      </div>
    </article>
  );
}

/** Highlights to pick as evidence: those on either end first, then the rest, filtered by Bob's words. */
function evidenceChoices(highlights: readonly Highlight[], r: Relation, query: string, picked: readonly string[]): Highlight[] {
  const q = query.trim().toLowerCase();
  const near = (h: Highlight) => h.usedBy.includes(r.fromId) || h.usedBy.includes(r.toId);
  const shown = highlights.filter((h) => picked.includes(h.id) || (q ? h.text.toLowerCase().includes(q) : near(h)));
  return shown.sort((a, b) => Number(near(b)) - Number(near(a))).slice(0, 40);
}

/** What one did to the other (an effect from Bob's vocabulary, or a word of his own), the highlights that show it, and a note. */
export function RelationEditor({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const r = doc.relations.find((x) => x.id === id);
  const [effect, setEffect] = useState(r?.effect ?? '');
  const [own, setOwn] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>(r?.highlightIds ?? []);
  const [note, setNote] = useState(r?.note ?? '');
  const [query, setQuery] = useState('');
  if (!r) return <div className="notice">This connection was deleted.</div>;
  const words = effectWords(doc.relations);
  if (effect && !words.includes(effect)) words.push(effect);
  const choices = evidenceChoices(doc.highlights, r, query, picked);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const word = (own ?? effect).trim().toLowerCase();
    const next: Relation = { ...r, effect: word || undefined, highlightIds: picked.length ? picked : undefined, note: note.trim() || undefined };
    update((d) => upsert(d, 'relations', next));
    nav.replace({ type: 'relation', id });
  };

  return (
    <form onSubmit={save} data-testid="relation-editor">
      <h2>{titleOf(doc, r.fromId) ?? 'Missing entry'} → {titleOf(doc, r.toId) ?? 'Missing entry'}</h2>
      <h3 id="eff-label">What it did</h3>
      <div className="effectpick" role="group" aria-labelledby="eff-label">
        {words.map((w) => (
          <button type="button" key={w} aria-pressed={own === null && effect === w} onClick={() => { setOwn(null); setEffect(effect === w ? '' : w); }}>{w}</button>
        ))}
        <button type="button" className="own" aria-pressed={own !== null} onClick={() => setOwn(own === null ? '' : null)}>+ your own</button>
      </div>
      {own !== null && (
        <input className="input" autoFocus aria-label="Your own word" placeholder="starved, emboldened…" value={own} onChange={(e) => setOwn(e.target.value)} />
      )}
      {!effect && own === null && <p className="hint" style={{ color: 'var(--muted)' }}>Without one it reads “{describeRelation(r.type, 'out').toLowerCase()}”.</p>}

      <h3>Evidence</h3>
      <input className="input" type="search" aria-label="Find a highlight" placeholder="Find a highlight…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="evidencepick">
        {choices.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>{query ? 'No highlights match.' : 'No highlights on either entry yet. Find one above.'}</p>}
        {choices.map((h) => (
          <label className="check" key={h.id}>
            <input type="checkbox" checked={picked.includes(h.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, h.id] : picked.filter((x) => x !== h.id))} />
            <span className="quote">“{h.text.length > 160 ? `${h.text.slice(0, 160)}…` : h.text}”</span>
          </label>
        ))}
      </div>

      <h3>Note</h3>
      <textarea className="input" aria-label="Note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="actions">
        <button className="btn primary">Save changes</button>
        <button type="button" className="btn" onClick={() => nav.replace({ type: 'relation', id })}>Cancel</button>
      </div>
    </form>
  );
}
