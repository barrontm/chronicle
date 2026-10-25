import { useState } from 'react';
import { undoFor, type Undo } from '../../model/bulk';
import { ensureRegion, hasRegionOrder, mergeRegions, newId, regionCount, regionNamed, remove, removeRegion, renameRegion, setRegionOrders, setRegionOutline, setRegionParent, upsert } from '../../model/doc';
import { polityRegion } from '../../model/overview';
import { allRegions } from '../../model/subjects';
import type { PolityGroup, Region, Territory, TimelineDoc } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import type { Nav } from '../nav';
import { outlineInWords, RegionWhere } from '../RegionWhere';

/**
 * The Library's Regions tab: Bob's regions with the larger areas they're in (Greece →
 * Mediterranean), and his groups of city-states that fold into one strip on the overview.
 */
export function RegionsAndGroups({ nav, onDone }: { nav: Nav; onDone: (undo: Undo, msg: string) => void }) {
  const { doc, update, readOnly } = useDoc();
  const [editing, setEditing] = useState<string | null>(null);
  // Every region with a record or in use, so one typed some other way can still be edited.
  const regions = [...new Set([...(doc.regions ?? []).map((r) => r.name), ...allRegions(doc)])].sort((a, b) => a.localeCompare(b));
  const parents = [...new Set((doc.regions ?? []).flatMap((r) => (r.parent?.trim() ? [r.parent.trim()] : [])))].sort((a, b) => a.localeCompare(b));
  /** One change to a region, with one Undo in the bar under the timeline. */
  const change = (name: string, fn: (d: TimelineDoc, id: string, now: number) => TimelineDoc, msg: string) => {
    const now = Date.now();
    const run = (d: TimelineDoc) => { const e = ensureRegion(d, name, now); return fn(e.doc, e.region.id, now); };
    const undo = undoFor(doc, run(doc));
    update(run);
    onDone(undo, msg);
  };
  const itemById = new Map(doc.items.map((i) => [i.id, i]));
  const regionOf = (id: string) => { const t = doc.territories.find((x) => x.id === id); return t ? polityRegion(t, t.itemId ? itemById.get(t.itemId) : undefined) : ''; };
  const elsewhere = doc.territories.filter((t) => !regionOf(t.id)).sort((a, b) => a.title.localeCompare(b.title));
  const groups = [...(doc.groups ?? [])].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div data-testid="regions-tab">
      <h3>Regions</h3>
      <p className="lede">Each region is a band on the overview. Put it in a larger area, such as Mediterranean, and its neighbours sit together under that name. Rename a region, merge it into another, or delete it, and everything in it follows.</p>
      {regions.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>No regions yet. Give a period or a territory a region, such as Greece.</p>}
      <ul className="region-list">
        {regions.map((r) => (
          <RegionRow
            key={r}
            region={r}
            others={regions.filter((x) => x !== r)}
            holds={regionCount(doc, r)}
            parent={regionNamed(doc, r)?.parent ?? ''}
            outline={regionNamed(doc, r)?.outline}
            territories={doc.territories}
            disabled={!!readOnly}
            onOutline={(o) => change(r, (d) => setRegionOutline(d, r, o), o ? `${r} is now where you picked on the map.` : `${r} is where its territories are again.`)}
            onDraw={() => nav.draw((g) => change(r, (d) => setRegionOutline(d, r, { geometry: g }), `Drew ${r} on the map.`))}
            onParent={(p) => update((d) => setRegionParent(d, r, p || undefined))}
            onRename={(name) => change(r, (d, id, now) => renameRegion(d, id, name, now), regions.includes(name) ? `Merged ${r} into ${name}.` : `Renamed ${r} to ${name}.`)}
            onMerge={(into) => change(r, (d, id, now) => { const e = ensureRegion(d, into, now); return mergeRegions(e.doc, id, e.region.id, now); }, `Merged ${r} into ${into}.`)}
            onDelete={() => change(r, (d, id, now) => removeRegion(d, id, now), `Deleted ${r}; what it held is in Elsewhere.`)}
          />
        ))}
      </ul>
      {hasRegionOrder(doc) && (
        <p className="hint region-order">
          You’ve moved some bands on the timeline; the rest order themselves around them.{' '}
          <button type="button" className="btn small" disabled={!!readOnly} onClick={() => {
            const now = Date.now();
            const run = (d: TimelineDoc) => setRegionOrders(d, new Map(), now);
            const undo = undoFor(doc, run(doc));
            update(run);
            onDone(undo, 'Bands back in the automatic order.');
          }}>Back to automatic order</button>
        </p>
      )}
      <datalist id="region-parents">{parents.map((p) => <option key={p} value={p} />)}</datalist>
      {elsewhere.length > 0 && (
        <>
          <p className="lede">In <strong>Elsewhere</strong>, with no region yet. Open one and give it a region under Edit.</p>
          <ul className="linklist">
            {elsewhere.map((t) => <li key={t.id}><button onClick={() => nav.open({ type: 'territory', id: t.id })}><strong>{t.title}</strong></button></li>)}
          </ul>
        </>
      )}

      <h3>Groups</h3>
      <p className="lede">City-states that fold into one strip on the overview, such as Classical Greece. Click the strip to show each in its own row.</p>
      <ul className="linklist">
        {groups.map((g) => editing === g.id ? null : (
          <li key={g.id}>
            <button onClick={() => setEditing(g.id)} aria-label={`Edit the group ${g.title}`}>
              <strong>{g.title}</strong>
              <small>{g.territoryIds.map((id) => doc.territories.find((t) => t.id === id)?.title).filter(Boolean).join(', ') || 'No members yet'}</small>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <GroupForm
          key={editing}
          group={doc.groups?.find((g) => g.id === editing)}
          onDone={() => setEditing(null)}
        />
      )}
      {!editing && <button className="btn small" disabled={!!readOnly || doc.territories.length < 2} onClick={() => setEditing(newId('g'))}>New group</button>}
    </div>
  );
}

const holdsInWords = ({ items, territories }: { items: number; territories: number }) =>
  [items && `${items} ${items === 1 ? 'entry' : 'entries'}`, territories && `${territories} ${territories === 1 ? 'territory' : 'territories'}`].filter(Boolean).join(' and ') || 'Nothing in it yet';

/**
 * A region: what it holds and where it is on the map, its larger area (saved when Bob leaves the
 * field or presses Enter), and Rename, Merge into…, Where on the map and Delete.
 */
function RegionRow({ region, others, holds, parent, outline, territories, disabled, onParent, onRename, onMerge, onDelete, onOutline, onDraw }: {
  region: string; others: string[]; holds: { items: number; territories: number }; parent: string;
  outline: Region['outline']; territories: readonly Territory[]; disabled: boolean;
  onParent: (p: string) => void; onRename: (name: string) => void; onMerge: (into: string) => void; onDelete: () => void;
  onOutline: (o: Region['outline']) => void; onDraw: () => void;
}) {
  const [v, setV] = useState(parent);
  const [mode, setMode] = useState<'rename' | 'merge' | 'where' | null>(null);
  const where = outlineInWords(outline, territories);
  const [name, setName] = useState(region);
  const [into, setInto] = useState('');
  const commit = () => { if (v.trim() !== parent) onParent(v.trim()); };
  const n = holds.items + holds.territories;
  const del = () => {
    if (confirm(n ? `Delete the region ${region}? Its ${holdsInWords(holds)} move to Elsewhere.` : `Delete the region ${region}?`)) onDelete();
  };
  return (
    <li className="region-row" data-testid="region-row" aria-label={region}>
      <div className="region-head">
        <strong className="grow">{region}</strong>
        {!mode && (
          <span className="region-actions">
            <button type="button" className="btn small quiet" disabled={disabled} onClick={() => { setName(region); setMode('rename'); }} aria-label={`Rename ${region}`}>Rename</button>
            <button type="button" className="btn small quiet" disabled={disabled || !others.length} onClick={() => { setInto(''); setMode('merge'); }} aria-label={`Merge ${region} into another region`}>Merge into…</button>
            <button type="button" className="btn small quiet" disabled={disabled} onClick={() => setMode('where')} aria-label={`Where ${region} is on the map`}>Where on the map</button>
            <button type="button" className="btn small quiet danger" disabled={disabled} onClick={del} aria-label={`Delete ${region}`}>Delete</button>
          </span>
        )}
      </div>
      <small className="region-holds">{holdsInWords(holds)} · {where ? `On the map: ${where}` : 'On the map where its territories are'}</small>
      {mode === 'where' && (
        <RegionWhere
          region={region}
          outline={outline}
          territories={territories}
          disabled={disabled}
          onSave={(o) => { onOutline(o); setMode(null); }}
          onDraw={() => { setMode(null); onDraw(); }}
          onCancel={() => setMode(null)}
        />
      )}
      {mode === 'rename' && (
        <form className="editor-row" aria-label={`Rename ${region}`} onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== region) onRename(name.trim()); setMode(null); }}>
          <input className="grow" value={name} autoFocus aria-label={`New name for ${region}`} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setMode(null); }} />
          <button className="btn small primary" disabled={!name.trim() || name.trim() === region}>{others.includes(name.trim()) ? 'Merge' : 'Rename'}</button>
          <button type="button" className="btn small" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}
      {mode === 'rename' && others.includes(name.trim()) && <small className="hint">{name.trim()} is already a region: {region} merges into it.</small>}
      {mode === 'merge' && (
        <form className="editor-row" aria-label={`Merge ${region}`} onSubmit={(e) => { e.preventDefault(); if (into) onMerge(into); setMode(null); }}>
          <select className="grow" value={into} autoFocus aria-label={`Merge ${region} into`} onChange={(e) => setInto(e.target.value)}>
            <option value="">Merge into…</option>
            {others.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button className="btn small primary" disabled={!into}>Merge</button>
          <button type="button" className="btn small" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}
      <label className="editor-row region-parent">
        <span>Part of</span>
        <input
          className="grow"
          value={v}
          placeholder="A larger area, such as Mediterranean"
          list="region-parents"
          disabled={disabled}
          aria-label={`${region} is part of`}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        />
      </label>
    </li>
  );
}

function GroupForm({ group, onDone }: { group?: PolityGroup; onDone: () => void }) {
  const { doc, update } = useDoc();
  const [title, setTitle] = useState(group?.title ?? '');
  const [ids, setIds] = useState<string[]>(group?.territoryIds ?? []);
  const itemById = new Map(doc.items.map((i) => [i.id, i]));
  const regionOf = (id: string) => { const t = doc.territories.find((x) => x.id === id); return t ? polityRegion(t, t.itemId ? itemById.get(t.itemId) : undefined) : ''; };
  // A polity folds into one group: those in another are named, not offered.
  const inOther = new Map((doc.groups ?? []).filter((g) => g.id !== group?.id).flatMap((g) => g.territoryIds.map((id) => [id, g.title] as const)));
  const territories = [...doc.territories].sort((a, b) => regionOf(a.id).localeCompare(regionOf(b.id)) || a.title.localeCompare(b.title));
  const region = ids.length ? regionOf(ids[0]) : undefined;
  const astray = ids.filter((id) => regionOf(id) !== region);
  const valid = !!title.trim() && ids.length >= 2;
  return (
    <form className="snapshot" data-testid="group-form" aria-label={group ? `Edit ${group.title}` : 'New group'} onSubmit={(e) => {
      e.preventDefault();
      if (!valid) return;
      update((d) => upsert(d, 'groups', { id: group?.id ?? newId('g'), title: title.trim(), territoryIds: ids, updatedAt: 0 }));
      onDone();
    }}>
      <Field label="Group name"><input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="Classical Greece" /></Field>
      <fieldset className="checklist">
        <legend>Members</legend>
        {territories.map((t) => {
          const other = inOther.get(t.id);
          return (
            <label key={t.id} className={other ? 'muted' : undefined}>
              <input type="checkbox" checked={ids.includes(t.id)} disabled={!!other} onChange={(e) => setIds((xs) => (e.target.checked ? [...xs, t.id] : xs.filter((x) => x !== t.id)))} />
              {' '}{t.title} <small>· {regionOf(t.id) || 'Elsewhere'}{other ? ` · in ${other}` : ''}</small>
            </label>
          );
        })}
      </fieldset>
      {astray.length > 0 && <div className="notice" role="status">A group sits in one region, {region || 'Elsewhere'}: {astray.map((id) => doc.territories.find((t) => t.id === id)?.title).join(', ')} {astray.length === 1 ? 'stays' : 'stay'} in {astray.length === 1 ? 'its own row' : 'their own rows'} until {astray.length === 1 ? 'it’s' : 'they’re'} in {region || 'Elsewhere'} too.</div>}
      {ids.length < 2 && <small className="hint">Pick at least two.</small>}
      <div className="actions">
        <button className="btn primary" disabled={!valid}>{group ? 'Save group' : 'Add group'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        {group && <button type="button" className="btn danger" onClick={() => { update((d) => remove(d, 'groups', group.id)); onDone(); }}>Delete group</button>}
      </div>
    </form>
  );
}
