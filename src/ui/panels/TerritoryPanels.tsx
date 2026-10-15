import type { FeatureCollection } from 'geojson';
import { useMemo, useRef, useState } from 'react';
import { BASEMAP_YEARS, basemapFor, BASEMAPS_CREDIT, fetchBasemap, polityNames, snapshotsFor, type BasemapYear } from '../../data/basemaps';
import { compareHistDate, formatRange, formatYear, toDecimalYear } from '../../model/dates';
import { newId, notesFor, remove, upsert } from '../../model/doc';
import type { Territory, TerritorySnapshot } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field, RecordPicker } from '../fields';
import type { Nav } from '../nav';
import { titleOf } from '../util';

const km2 = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const OFFLINE = 'You’re offline. Loading historical maps needs a connection (maps you’ve already opened still work).';

function spanOf(t: Territory): string {
  const first = t.snapshots[0];
  const last = t.snapshots.at(-1);
  if (!first || !last) return 'No maps yet';
  return formatRange(first.from, last.to ?? last.from);
}

const sortSnaps = (s: TerritorySnapshot[]) => [...s].sort((a, b) => compareHistDate(a.from, b.from));

export function TerritoryView({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const t = doc.territories.find((x) => x.id === id);
  if (!t) return <div className="notice">This territory was deleted.</div>;
  const cat = doc.categories.find((c) => c.id === t.categoryId);
  const notes = notesFor(doc, id);
  const values = doc.series.filter((s) => s.regions?.[id]);
  return (
    <article data-testid="territory-view">
      <h2>{t.title}</h2>
      <div className="meta">
        <span style={{ '--c': cat?.color } as React.CSSProperties}><span className="swatch" />{cat?.label}</span>
        <span>Territory</span>
        <span>{spanOf(t)}</span>
      </div>
      {t.itemId && (
        <p>On your timeline: <button className="btn small quiet" onClick={() => nav.open({ type: 'item', id: t.itemId! })}>{titleOf(doc, t.itemId) ?? 'Missing entry'}</button></p>
      )}

      <h3>Borders over time</h3>
      <ul className="linklist">
        {t.snapshots.map((s, i) => (
          <li key={i}>
            <button onClick={() => nav.showOnMap(toDecimalYear(s.from))}>
              <strong>{s.to ? formatRange(s.from, s.to) : `From ${formatYear(s.from.y)}`}</strong>
              {s.areaKm2 !== undefined && <small>about {km2.format(s.areaKm2)} km²</small>}
            </button>
          </li>
        ))}
      </ul>

      {values.length > 0 && (
        <>
          <h3>Trends</h3>
          <ul className="linklist">
            {values.map((s) => <li key={s.id}><button onClick={() => nav.open({ type: 'series', id: s.id })}><strong>{s.title}</strong></button></li>)}
          </ul>
        </>
      )}

      <h3>Notes</h3>
      <ul className="linklist">
        {notes.map((n) => <li key={n.id}><button onClick={() => nav.open({ type: 'note', id: n.id })}><strong>{n.title}</strong></button></li>)}
      </ul>
      <button className="btn small" onClick={() => nav.open({ type: 'new-note', linkedIds: [id] })}>Write a note</button>

      {t.source && (
        <p className="lede" style={{ marginTop: 16 }}>
          Borders from {t.source.url ? <a href={t.source.url} target="_blank" rel="noreferrer">{t.source.name}</a> : t.source.name}.
        </p>
      )}

      <div className="actions">
        <button className="btn primary" onClick={() => nav.replace({ type: 'territory', id, edit: true })}>Edit</button>
        {t.snapshots[0] && <button className="btn" onClick={() => nav.showOnMap(toDecimalYear(t.snapshots[0].from))}>Show on map</button>}
        <button className="btn danger" onClick={() => {
          if (confirm(`Delete the territory “${t.title}”? Notes about it are kept.`)) {
            update((d) => remove(d, 'territories', id));
            nav.close();
          }
        }}>Delete</button>
      </div>
    </article>
  );
}

export function TerritoryEditor({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const existing = doc.territories.find((x) => x.id === id);
  const [d, setD] = useState<Territory | undefined>(existing);
  if (!d) return <div className="notice">This territory was deleted.</div>;
  const set = <K extends keyof Territory>(k: K, v: Territory[K]) => setD({ ...d, [k]: v });
  return (
    <form data-testid="territory-editor" onSubmit={(e) => {
      e.preventDefault();
      if (!d.title.trim()) return;
      update((doc) => upsert(doc, 'territories', { ...d, title: d.title.trim() }));
      nav.replace({ type: 'territory', id });
    }}>
      <h2>Edit territory</h2>
      <Field label="Name"><input value={d.title} onChange={(e) => set('title', e.target.value)} required /></Field>
      <Field label="Category">
        <select value={d.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <LinkedEntry value={d.itemId} onChange={(itemId) => set('itemId', itemId)} />
      <h3>Borders over time</h3>
      <div className="editor-list">
        {d.snapshots.map((s, i) => (
          <div className="editor-row" key={i}>
            <span className="grow">{s.to ? formatRange(s.from, s.to) : `From ${formatYear(s.from.y)}`}</span>
            <button type="button" className="btn small quiet" onClick={() => set('snapshots', d.snapshots.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={!d.title.trim()}>Save changes</button>
        <button type="button" className="btn" onClick={() => nav.replace({ type: 'territory', id })}>Cancel</button>
      </div>
    </form>
  );
}

function LinkedEntry({ value, onChange }: { value?: string; onChange: (id: string | undefined) => void }) {
  const { doc } = useDoc();
  return (
    <Field label="Entry on your timeline" hint="Optional: the period or person this territory belongs to.">
      {value ? (
        <div className="editor-row">
          <span className="grow">{titleOf(doc, value) ?? 'Missing entry'}</span>
          <button type="button" className="btn small quiet" onClick={() => onChange(undefined)}>Unlink</button>
        </div>
      ) : (
        <RecordPicker doc={doc} onPick={onChange} placeholder="Search your timeline…" />
      )}
    </Field>
  );
}

/**
 * Bring a polity in from the historical-basemaps dataset: pick a map year, pick
 * the polity, choose how far back and forward to look, and its borders from
 * every map in that range become one territory (or extend an existing one,
 * e.g. Roman Republic → Roman Empire).
 */
export function TerritoryImport({ year, nav }: { year: number; nav: Nav }) {
  const { doc, update } = useDoc();
  const [mapYear, setMapYear] = useState<BasemapYear>(() => basemapFor(year));
  const [names, setNames] = useState<string[] | null>(null);
  const [filter, setFilter] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [found, setFound] = useState<TerritorySnapshot[] | null>(null);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(doc.categories.find((c) => c.id === 'politics')?.id ?? doc.categories[0]?.id ?? '');
  const [itemId, setItemId] = useState<string | undefined>();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const fail = (e: unknown) => setError(navigator.onLine ? (e as Error).message : OFFLINE);

  const loadNames = async (b: BasemapYear) => {
    const token = ++run.current;
    setMapYear(b);
    setNames(null);
    setName(null);
    setFound(null);
    setError(null);
    setBusy(`Loading the map for ${formatYear(b.y)}…`);
    try {
      const fc = await fetchBasemap(b);
      if (token === run.current) setNames(polityNames(fc));
    } catch (e) {
      if (token === run.current) fail(e);
    } finally {
      if (token === run.current) setBusy(null);
    }
  };

  const choose = (n: string) => {
    const i = BASEMAP_YEARS.indexOf(mapYear);
    setName(n);
    setTitle(n);
    setFound(null);
    setRange([Math.max(0, i - 4), Math.min(BASEMAP_YEARS.length - 1, i + 4)]);
    const sameName = doc.items.find((it) => it.title.toLowerCase() === n.toLowerCase());
    setItemId(sameName?.id);
    setTarget(doc.territories.find((t) => t.title.toLowerCase() === n.toLowerCase())?.id ?? '');
  };

  const search = async () => {
    if (!name) return;
    const token = ++run.current;
    const years = BASEMAP_YEARS.slice(range[0], range[1] + 1);
    const loaded: Array<{ year: BasemapYear; fc: FeatureCollection }> = [];
    setError(null);
    try {
      for (const [i, b] of years.entries()) {
        setBusy(`Reading map ${i + 1} of ${years.length} (${formatYear(b.y)})…`);
        loaded.push({ year: b, fc: await fetchBasemap(b) });
        if (token !== run.current) return;
      }
      setFound(snapshotsFor(name, loaded));
    } catch (e) {
      if (token === run.current) fail(e);
    } finally {
      if (token === run.current) setBusy(null);
    }
  };

  const save = () => {
    if (!found?.length || !title.trim()) return;
    const existing = doc.territories.find((t) => t.id === target);
    let territory: Territory;
    if (existing) {
      // Newly found maps replace any the territory already had for the same year.
      const fromYears = new Set(found.map((s) => s.from.y));
      territory = { ...existing, snapshots: sortSnaps([...existing.snapshots.filter((s) => !fromYears.has(s.from.y)), ...found]), itemId: existing.itemId ?? itemId };
    } else {
      territory = { id: newId('t'), title: title.trim(), categoryId, snapshots: found, itemId, source: BASEMAPS_CREDIT, updatedAt: 0 };
    }
    update((d) => upsert(d, 'territories', territory));
    nav.replace({ type: 'territory', id: territory.id });
    nav.showOnMap(toDecimalYear(found[0].from));
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (names ?? []).filter((n) => !q || n.toLowerCase().includes(q));
  }, [names, filter]);

  return (
    <div data-testid="territory-import">
      <h2>Add a territory</h2>
      <p className="lede">Borders come from historical-basemaps, a set of world maps for about 50 years in history. They’re approximate, especially for early periods.</p>

      <div className="editor-row">
        <div className="grow">
          <Field label="Map year">
            <select value={mapYear.file} onChange={(e) => { const b = BASEMAP_YEARS.find((x) => x.file === e.target.value)!; setMapYear(b); setNames(null); setName(null); }}>
              {BASEMAP_YEARS.map((b) => <option key={b.file} value={b.file}>{formatYear(b.y)}</option>)}
            </select>
          </Field>
        </div>
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => void loadNames(mapYear)}>Show its polities</button>
      </div>

      {busy && <div className="notice" role="status">{busy}</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}

      {names && !name && (
        <>
          <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${names.length} polities…`} aria-label="Search polities" autoFocus />
          <ul className="linklist polity-list" data-testid="polities">
            {shown.slice(0, 200).map((n) => <li key={n}><button onClick={() => choose(n)}><strong>{n}</strong></button></li>)}
          </ul>
          {shown.length === 0 && <div className="notice">Nothing matches “{filter}” on the {formatYear(mapYear.y)} map. Names can change over time; try another year.</div>}
        </>
      )}

      {name && (
        <>
          <h3>{name}</h3>
          <p className="lede">Look for “{name}” on every map in this range. Each map’s borders apply until the next map’s year.</p>
          <div className="row">
            <Field label="From">
              <select value={range[0]} onChange={(e) => { setRange([Number(e.target.value), Math.max(Number(e.target.value), range[1])]); setFound(null); }}>
                {BASEMAP_YEARS.map((b, i) => <option key={b.file} value={i}>{formatYear(b.y)}</option>)}
              </select>
            </Field>
            <Field label="To">
              <select value={range[1]} onChange={(e) => { setRange([Math.min(range[0], Number(e.target.value)), Number(e.target.value)]); setFound(null); }}>
                {BASEMAP_YEARS.map((b, i) => <option key={b.file} value={i}>{formatYear(b.y)}</option>)}
              </select>
            </Field>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void search()}>Look through {range[1] - range[0] + 1} maps</button>
            <button type="button" className="btn" onClick={() => { setName(null); setFound(null); }}>Pick another</button>
          </div>
        </>
      )}

      {found && (
        found.length === 0 ? (
          <div className="notice">“{name}” isn’t on any map in that range. Try a wider range.</div>
        ) : (
          <form data-testid="territory-found" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="notice" role="status">Found on {found.length} {found.length === 1 ? 'map' : 'maps'}: {found.map((s) => formatYear(s.from.y)).join(', ')}.</div>
            {doc.territories.length > 0 && (
              <Field label="Add to">
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">A new territory</option>
                  {doc.territories.map((t) => <option key={t.id} value={t.id}>{t.title} (add these maps)</option>)}
                </select>
              </Field>
            )}
            {!target && (
              <>
                <Field label="Name"><input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
                <Field label="Category">
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </Field>
                <LinkedEntry value={itemId} onChange={setItemId} />
              </>
            )}
            <div className="actions">
              <button className="btn primary" disabled={!target && !title.trim()}>Add to map</button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
