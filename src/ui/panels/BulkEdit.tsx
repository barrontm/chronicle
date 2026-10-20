import { useState } from 'react';
import { bulkEdit, isPeriod, type BulkPatch, type Undo } from '../../model/bulk';
import { sortLanes } from '../../model/lanes';
import { regionsIn } from '../../model/subjects';
import { LANES, type Lane, type OverviewMark } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import { LaneChips } from '../LaneChips';
import type { Nav } from '../nav';

const KEEP = '';
type OverviewChoice = typeof KEEP | 'none' | OverviewMark;

/** How many shown by name before "and N more". */
const NAMED = 5;

/**
 * Edit the entries box-selected on the timeline all at once. Every field starts as "Leave as is",
 * so only what Bob changes is set; the rest of each entry stays its own.
 */
export function BulkEdit({ ids, nav, onDone }: { ids: string[]; nav: Nav; onDone: (undo: Undo, msg: string) => void }) {
  const { doc, update } = useDoc();
  const items = doc.items.filter((i) => ids.includes(i.id));
  const shared = LANES.filter((l) => items.length && items.every((i) => i.lanes?.includes(l)));
  const [categoryId, setCategoryId] = useState(KEEP);
  const [lanes, setLanes] = useState<Lane[] | null>(null);
  const [overview, setOverview] = useState<OverviewChoice>(KEEP);
  const [region, setRegion] = useState('');
  const periods = items.filter(isPeriod).length;

  const patch: BulkPatch = {
    ...(categoryId !== KEEP ? { categoryId } : {}),
    ...(lanes ? { lanes } : {}),
    ...(overview !== KEEP ? { overview: overview === 'none' ? null : overview } : {}),
    ...(region.trim() && periods ? { region } : {}),
  };
  const touched = Object.keys(patch).length > 0;
  const n = items.length;
  const entries = (k: number) => `${k} ${k === 1 ? 'entry' : 'entries'}`;

  const save = () => {
    const now = Date.now();
    const { undo, changed } = bulkEdit(doc, ids, patch, now);
    update((d) => bulkEdit(d, ids, patch, now).doc);
    onDone(undo, changed ? `Changed ${entries(changed)}.` : 'Nothing needed changing.');
    nav.close();
  };

  if (!n) return <p className="notice">These entries are gone.</p>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (touched) save(); }} data-testid="bulk-edit">
      <h2>Edit {entries(n)}</h2>
      <p className="hint bulk-names">
        {items.slice(0, NAMED).map((i) => i.title).join(', ')}{n > NAMED ? `, and ${n - NAMED} more` : ''}
      </p>
      <p className="hint">What you change here is set on all of them. Everything else stays as each one has it.</p>
      <Field label="Category">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value={KEEP}>Leave as is</option>
          {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Lanes" hint={lanes ? (lanes.length ? 'All of them get exactly these lanes.' : 'All off: each is sorted automatically.') : 'Left as each one has them. Pick lanes to give all of them the same.'}>
        <LaneChips value={lanes ?? shared} onToggle={(l) => {
          const had = lanes ?? shared;
          setLanes(had.includes(l) ? had.filter((x) => x !== l) : sortLanes([...had, l]));
        }} />
      </Field>
      <Field label="In the overview">
        <select value={overview} onChange={(e) => setOverview(e.target.value as OverviewChoice)}>
          <option value={KEEP}>Leave as is</option>
          <option value="none">Not shown</option>
          <option value="shown">Show in the overview</option>
          <option value="world">World event</option>
        </select>
      </Field>
      {periods > 0 && (
        <Field label="Region" hint={`The row ${periods === n ? 'they sit' : `the ${periods === 1 ? 'period sits' : `${periods} periods sit`}`} in on the overview. Leave it empty to keep each one’s.`}>
          <input value={region} onChange={(e) => setRegion(e.target.value)} list="bulk-regions" />
        </Field>
      )}
      {periods > 0 && <datalist id="bulk-regions">{regionsIn(doc.items).map((r) => <option key={r} value={r} />)}</datalist>}
      <div className="actions">
        <button className="btn primary" type="submit" disabled={!touched}>Change {entries(n)}</button>
        <button className="btn" type="button" onClick={nav.close}>Cancel</button>
      </div>
    </form>
  );
}
