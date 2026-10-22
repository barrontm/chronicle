import { useState } from 'react';
import { newId, remove, setRegionParent, upsert } from '../../model/doc';
import { polityRegion } from '../../model/overview';
import { allRegions } from '../../model/subjects';
import type { PolityGroup } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import type { Nav } from '../nav';

/**
 * The Library's Regions tab: Bob's regions with the larger areas they're in (Greece →
 * Mediterranean), and his groups of city-states that fold into one strip on the overview.
 */
export function RegionsAndGroups({ nav }: { nav: Nav }) {
  const { doc, update, readOnly } = useDoc();
  const [editing, setEditing] = useState<string | null>(null);
  const regions = allRegions(doc);
  const parents = [...new Set(Object.values(doc.regionParents ?? {}))].sort((a, b) => a.localeCompare(b));
  const itemById = new Map(doc.items.map((i) => [i.id, i]));
  const regionOf = (id: string) => { const t = doc.territories.find((x) => x.id === id); return t ? polityRegion(t, t.itemId ? itemById.get(t.itemId) : undefined) : ''; };
  const elsewhere = doc.territories.filter((t) => !regionOf(t.id)).sort((a, b) => a.title.localeCompare(b.title));
  const groups = [...(doc.groups ?? [])].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div data-testid="regions-tab">
      <h3>Regions</h3>
      <p className="lede">Each region is a band on the overview. Put it in a larger area, such as Mediterranean, and its neighbours sit together under that name.</p>
      {regions.length === 0 && <p className="hint" style={{ color: 'var(--muted)' }}>No regions yet. Give a period or a territory a region, such as Greece.</p>}
      <div className="editor-list">
        {regions.map((r) => (
          <RegionRow key={r} region={r} parent={doc.regionParents?.[r] ?? ''} disabled={!!readOnly} onCommit={(p) => update((d) => setRegionParent(d, r, p || undefined))} />
        ))}
      </div>
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

/** A region's larger area, saved when Bob leaves the field or presses Enter. */
function RegionRow({ region, parent, disabled, onCommit }: { region: string; parent: string; disabled: boolean; onCommit: (p: string) => void }) {
  const [v, setV] = useState(parent);
  const commit = () => { if (v.trim() !== parent) onCommit(v.trim()); };
  return (
    <Field label={region}>
      <input
        value={v}
        placeholder="Part of…"
        list="region-parents"
        disabled={disabled}
        aria-label={`${region} is part of`}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
    </Field>
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
