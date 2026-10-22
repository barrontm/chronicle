import type { FeatureCollection } from 'geojson';
import { useMemo, useRef, useState } from 'react';
import { BASEMAP_YEARS, basemapFor, BASEMAPS_CREDIT, fetchBasemap, polityNames, seshatBordersFor, snapshotsFor, type BasemapYear, type FoundBorders } from '../../data/basemaps';
import { isCliopatria } from '../../data/cliopatria';
import { areaKm2, FINE, parseGeoJsonAreas, simplifyArea, type Area } from '../../data/geo';
import { compareHistDate, formatRange, formatYear, toDecimalYear } from '../../model/dates';
import { highlightsFor, newId, notesFor, remove, upsert } from '../../model/doc';
import { polityRegion } from '../../model/overview';
import { allRegions } from '../../model/subjects';
import type { Highlight, HistDate, StrengthPoint, Territory, TerritorySnapshot, TimelineDoc } from '../../model/types';
import { useDoc } from '../DocContext';
import { DateField, Field, RecordPicker } from '../fields';
import type { Nav } from '../nav';
import { useOnline } from '../useAi';
import { titleOf } from '../util';

const km2 = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const OFFLINE = 'You’re offline. Loading historical maps needs a connection (maps you’ve already opened still work).';

function spanOf(t: Territory): string {
  const first = t.snapshots[0];
  const last = t.snapshots.at(-1);
  if (!first || !last) return 'No maps yet';
  return last.to ? formatRange(first.from, last.to) : `From ${formatYear(first.from.y)}`;
}

const sortSnaps = (s: TerritorySnapshot[]) => [...s].sort((a, b) => compareHistDate(a.from, b.from));

/** Strength levels in Bob's words, 1 to 5. */
const LEVELS = ['1 · a sliver', '2 · minor', '3 · a power', '4 · a great power', '5 · dominant'] as const;
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Highlights a strength point can rest on: the territory's, its entry's, and those of what's connected to either. */
function strengthHighlights(doc: TimelineDoc, t: Territory): Highlight[] {
  const ids = new Set([t.id, ...(t.itemId ? [t.itemId] : [])]);
  for (const r of doc.relations) {
    if (ids.has(r.fromId) || ids.has(r.toId)) { ids.add(r.fromId); ids.add(r.toId); }
  }
  return [...new Set([...ids].flatMap((id) => highlightsFor(doc, id)))];
}

interface PointRow { k: string; p: StrengthPoint; ok: boolean }

export function TerritoryView({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const t = doc.territories.find((x) => x.id === id);
  if (!t) return <div className="notice">This territory was deleted.</div>;
  const cat = doc.categories.find((c) => c.id === t.categoryId);
  const notes = notesFor(doc, id);
  const values = doc.series.filter((s) => s.regions?.[id]);
  const region = polityRegion(t, doc.items.find((i) => i.id === t.itemId));
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
      <p data-testid="territory-region">{region ? <>Region on the overview: <strong>{region}</strong>{!t.region?.trim() && ' (from its entry)'}</> : <>Region on the overview: <strong>Elsewhere</strong>. Give it one under Edit to put it beside its neighbours.</>}</p>

      {!!t.strength?.length && (
        <>
          <h3>How strong it was</h3>
          <ul className="linklist strength-list">
            {t.strength.map((p, i) => {
              const quote = p.highlightIds?.map((h) => doc.highlights.find((x) => x.id === h)).find(Boolean);
              return (
                <li key={i}>
                  <button onClick={() => nav.showOnMap(toDecimalYear(p.at))}>
                    <strong>{formatYear(p.at.y)}: {LEVELS[p.level - 1]}</strong>
                    {quote && <small>“{clip(quote.text)}”</small>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
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
      {!isCliopatria(t.source) && <SeshatUpdate key={id} t={t} />}

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

/**
 * Replace a territory's borders with Seshat's, matched by its Wikidata id, else its name, in its
 * entry's years (else the years its borders cover). Shows what would change; nothing is replaced
 * until Bob confirms.
 */
function SeshatUpdate({ t }: { t: Territory }) {
  const { doc, update } = useDoc();
  const online = useOnline();
  const [state, setState] = useState<{ busy?: true; found?: FoundBorders; msg?: string }>({});
  const item = t.itemId ? doc.items.find((i) => i.id === t.itemId) : undefined;

  const look = async () => {
    if (!online) { setState({ msg: 'You’re offline. Seshat’s borders need a connection (ones you’ve already looked at still work).' }); return; }
    setState({ busy: true });
    try {
      const wanted = { wikidataId: t.wikidataId ?? item?.wikidataId, names: [t.title, item?.title ?? ''] };
      // Cut to the entry's own lifetime, as when adding from the tray; with no entry, take all Seshat has.
      const found = item?.start
        ? await seshatBordersFor(wanted, item.start, item.end)
        : await seshatBordersFor(wanted, t.snapshots[0]?.from, t.snapshots.at(-1)?.to, undefined, false);
      setState(found.snapshots.length ? { found } : { msg: `Seshat’s maps don’t have ${t.title}${item?.start || t.snapshots.length ? ' in its years' : ''}.` });
    } catch (e) {
      setState({ msg: (e as Error).message });
    }
  };

  const { found } = state;
  if (found) {
    const snaps = found.snapshots;
    return (
      <div className="seshat-update offer" data-testid="seshat-update">
        <p>
          Seshat has {snaps.length === 1 ? 'one set' : `${snaps.length} sets`} of borders for {found.name}, {spanOf({ ...t, snapshots: snaps })}.
          {' '}{t.snapshots.length ? `They replace your ${t.snapshots.length === 1 ? 'one set' : `${t.snapshots.length} sets`} (${spanOf(t)}).` : 'You have none yet.'}
        </p>
        <ul className="seshat-sets">
          {snaps.map((s, i) => (
            <li key={i}>{s.to ? formatRange(s.from, s.to) : `From ${formatYear(s.from.y)}`}{s.areaKm2 !== undefined && <small> · about {km2.format(s.areaKm2)} km²</small>}</li>
          ))}
        </ul>
        <div className="actions">
          <button className="btn primary" onClick={() => {
            // The panel then credits Seshat, and this offer goes away.
            update((d) => upsert(d, 'territories', { ...t, snapshots: snaps, source: found.source }));
          }}>Replace borders</button>
          <button className="btn" onClick={() => setState({})}>Keep mine</button>
        </div>
      </div>
    );
  }
  return (
    <div className="seshat-update">
      <button className="btn small" disabled={state.busy} onClick={look}>{state.busy ? 'Looking at Seshat’s maps…' : 'Update borders from Seshat'}</button>
      {state.msg && <p className="hint" role="status">{state.msg}</p>}
    </div>
  );
}

/** A snapshot being edited, with a stable key and whether its typed dates read correctly. */
interface Row { k: string; s: TerritorySnapshot; ok: boolean }

const snapshotOf = (geometry: Area, from: HistDate): TerritorySnapshot => ({ from, geometry, areaKm2: Math.round(areaKm2(geometry)) });

export function TerritoryEditor({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const existing = doc.territories.find((x) => x.id === id);
  const [d, setD] = useState<Territory | undefined>(existing);
  const [rows, setRows] = useState<Row[]>(() => (existing?.snapshots ?? []).map((s) => ({ k: newId('s'), s, ok: true })));
  const [points, setPoints] = useState<PointRow[]>(() => (existing?.strength ?? []).map((p) => ({ k: newId('p'), p, ok: true })));
  if (!d) return <div className="notice">This territory was deleted.</div>;
  const setPoint = (k: string, change: Partial<StrengthPoint>, ok = true) => setPoints((ps) => ps.map((r) => (r.k === k ? { ...r, p: { ...r.p, ...change }, ok } : r)));
  const quotes = strengthHighlights(doc, d);
  const entryRegion = doc.items.find((i) => i.id === d.itemId)?.region?.trim();
  const set = <K extends keyof Territory>(k: K, v: Territory[K]) => setD({ ...d, [k]: v });
  const setRow = (k: string, change: Partial<TerritorySnapshot>, ok: boolean) =>
    setRows((rs) => rs.map((r) => (r.k === k ? { ...r, s: { ...r.s, ...change }, ok } : r)));
  const addShape = (geometry: Area, year: number) => setRows((rs) => [...rs, { k: newId('s'), s: snapshotOf(geometry, { y: year }), ok: true }]);
  const backwards = rows.find((r) => r.s.to && compareHistDate(r.s.to, r.s.from) <= 0);
  const valid = !!d.title.trim() && rows.every((r) => r.ok) && !backwards && points.every((r) => r.ok);
  return (
    <form data-testid="territory-editor" onSubmit={(e) => {
      e.preventDefault();
      if (!valid) return;
      const strength = points.map((r) => r.p).sort((a, b) => compareHistDate(a.at, b.at));
      update((doc) => upsert(doc, 'territories', { ...d, title: d.title.trim(), region: d.region?.trim() || undefined, strength: strength.length ? strength : undefined, snapshots: sortSnaps(rows.map((r) => r.s)) }));
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
      <Field label="Region" hint={entryRegion ? `The band it sits in on the overview. Empty: ${entryRegion}, from its entry.` : 'The band it sits in on the overview, such as Greece. Empty: Elsewhere.'}>
        <input value={d.region ?? ''} onChange={(e) => set('region', e.target.value || undefined)} list="territory-regions" placeholder={entryRegion} />
      </Field>
      <datalist id="territory-regions">{allRegions(doc).map((r) => <option key={r} value={r} />)}</datalist>

      <h3>How strong it was</h3>
      <p className="lede">How strong it was at a date, from 1 (a sliver) to 5 (dominant), with straight lines between your dates. This sets how thick its strip is on the overview, in place of the size of its borders.</p>
      <div className="editor-list">
        {points.map((r, i) => (
          <fieldset className="snapshot" key={r.k} aria-label={`Strength ${i + 1}`}>
            <div className="row">
              <DateField label="At" value={r.p.at} onChange={(at, ok) => setPoint(r.k, at ? { at } : {}, ok && !!at)} />
              <Field label="Strength">
                <select value={r.p.level} onChange={(e) => setPoint(r.k, { level: Number(e.target.value) as StrengthPoint['level'] })}>
                  {LEVELS.map((l, j) => <option key={j} value={j + 1}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div className="editor-row beside-input">
              <div className="grow">
                <Field label="Resting on" hint={quotes.length ? undefined : 'Highlight a passage about it, or its entry, to cite it here.'}>
                  <select value={r.p.highlightIds?.[0] ?? ''} onChange={(e) => setPoint(r.k, { highlightIds: e.target.value ? [e.target.value] : undefined })} disabled={!quotes.length}>
                    <option value="">No highlight</option>
                    {quotes.map((h) => <option key={h.id} value={h.id}>“{clip(h.text, 70)}”</option>)}
                  </select>
                </Field>
              </div>
              <button type="button" className="btn small quiet" onClick={() => setPoints((ps) => ps.filter((x) => x.k !== r.k))}>Remove</button>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => setPoints((ps) => [...ps, { k: newId('p'), p: { at: ps.at(-1)?.p.at ?? d.snapshots[0]?.from ?? { y: 0 }, level: 3 }, ok: true }])}>Add a strength</button>
      </div>

      <h3>Borders over time</h3>
      <p className="lede">Each set of borders applies from its first year until the year you give (or until the next set).</p>
      <div className="editor-list">
        {rows.map((r, i) => (
          <fieldset className="snapshot" key={r.k} aria-label={`Borders ${i + 1}`}>
            <div className="row">
              <DateField label="From" value={r.s.from} onChange={(from, ok) => setRow(r.k, from ? { from } : {}, ok)} />
              <DateField label="Until" optional value={r.s.to} onChange={(to, ok) => setRow(r.k, { to }, ok)} />
            </div>
            <div className="editor-row">
              <small className="grow">{r.s.areaKm2 !== undefined ? `About ${km2.format(r.s.areaKm2)} km²` : ''}</small>
              <button type="button" className="btn small quiet" onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))}>Remove</button>
            </div>
          </fieldset>
        ))}
      </div>
      {backwards && <div className="notice bad" role="alert">“Until” needs to come after “From”.</div>}
      <div className="actions">
        <button type="button" className="btn" onClick={() => nav.draw(addShape)}>Draw borders</button>
      </div>
      <GeoJsonFile onPick={(g) => addShape(g.geometry, d.snapshots.at(-1)?.from.y ?? 0)} />
      <div className="actions">
        <button className="btn primary" disabled={!valid}>Save changes</button>
        <button type="button" className="btn" onClick={() => nav.replace({ type: 'territory', id })}>Cancel</button>
      </div>
    </form>
  );
}

/** Pick an area from a GeoJSON file (from geojson.io, QGIS, a paper's data…), simplified finely enough to keep small city-states. */
function GeoJsonFile({ onPick }: { onPick: (a: { name?: string; geometry: Area; file: string }) => void }) {
  const [areas, setAreas] = useState<{ file: string; list: Array<{ name?: string; geometry: Area }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = (file: string, a: { name?: string; geometry: Area }) => {
    const geometry = simplifyArea(a.geometry, FINE.tolerance, FINE.decimals);
    if (!geometry) return setError('That area is too small to keep.');
    setAreas(null);
    onPick({ name: a.name, geometry, file });
  };
  const read = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setAreas(null);
    try {
      const list = parseGeoJsonAreas(await f.text());
      if (list.length === 1) pick(f.name, list[0]);
      else setAreas({ file: f.name, list });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <Field label="Or bring borders from a GeoJSON file" hint="Areas from geojson.io, QGIS or a dataset. Works offline.">
        <input ref={input} type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(e) => void read(e.target.files?.[0])} />
      </Field>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {areas && (
        <>
          <p className="lede">This file has {areas.list.length} areas. Which one?</p>
          <ul className="linklist polity-list" data-testid="geojson-areas">
            {areas.list.map((a, i) => (
              <li key={i}><button type="button" onClick={() => pick(areas.file, a)}><strong>{a.name ?? `Area ${i + 1}`}</strong><small>about {km2.format(areaKm2(a.geometry))} km²</small></button></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** A territory from Bob's own borders: drawn on the map or brought from a file. */
function OwnBorders({ year, nav }: { year: number; nav: Nav }) {
  const { doc, update } = useDoc();
  const [shape, setShape] = useState<{ geometry: Area; source: string } | null>(null);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(doc.categories.find((c) => c.id === 'politics')?.id ?? doc.categories[0]?.id ?? '');
  const [itemId, setItemId] = useState<string | undefined>();
  const [from, setFrom] = useState<{ d?: HistDate; ok: boolean }>({ d: { y: year }, ok: true });
  const [to, setTo] = useState<{ d?: HistDate; ok: boolean }>({ ok: true });
  const backwards = !!(from.d && to.d && compareHistDate(to.d, from.d) <= 0);
  const valid = !!shape && !!title.trim() && !!from.d && from.ok && to.ok && !backwards;

  const save = () => {
    if (!valid) return;
    const territory: Territory = {
      id: newId('t'), title: title.trim(), categoryId, itemId,
      snapshots: [{ ...snapshotOf(shape.geometry, from.d!), ...(to.d ? { to: to.d } : {}) }],
      source: { name: shape.source }, updatedAt: 0,
    };
    update((d) => upsert(d, 'territories', territory));
    nav.replace({ type: 'territory', id: territory.id });
    nav.showOnMap(toDecimalYear(from.d!));
  };

  if (!shape) {
    return (
      <section data-testid="own-borders">
        <h3>Your own borders</h3>
        <p className="lede">Draw a city-state or any border the maps don’t have, or bring a GeoJSON file. Works offline. <button type="button" className="btn small quiet" onClick={() => nav.open({ type: 'help', section: 'territories' })}>How drawing works</button></p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => nav.draw((geometry) => setShape({ geometry, source: 'Drawn by me' }))}>Draw on the map</button>
        </div>
        <GeoJsonFile onPick={(a) => { setShape({ geometry: a.geometry, source: a.file }); if (a.name) setTitle(a.name); }} />
      </section>
    );
  }
  return (
    <form data-testid="own-borders" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h3>Your own borders</h3>
      <div className="notice" role="status">Borders ready: about {km2.format(areaKm2(shape.geometry))} km².</div>
      <Field label="Name"><input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></Field>
      <Field label="Category">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <div className="row">
        <DateField label="From" value={from.d} onChange={(d, ok) => setFrom({ d, ok })} />
        <DateField label="Until" optional value={to.d} onChange={(d, ok) => setTo({ d, ok })} />
      </div>
      {backwards && <div className="notice bad" role="alert">“Until” needs to come after “From”.</div>}
      <LinkedEntry value={itemId} onChange={setItemId} />
      <div className="actions">
        <button className="btn primary" disabled={!valid}>Add to map</button>
        <button type="button" className="btn" onClick={() => setShape(null)}>Start over</button>
      </div>
    </form>
  );
}

export function LinkedEntry({ value, onChange, hint = 'Optional: the period or person this territory belongs to.' }: { value?: string; onChange: (id: string | undefined) => void; hint?: string }) {
  const { doc } = useDoc();
  return (
    <Field label="Entry on your timeline" hint={hint}>
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
      <OwnBorders year={year} nav={nav} />

      <h3>From historical maps</h3>
      <p className="lede">Borders come from historical-basemaps, a set of world maps for about 50 years in history. They’re approximate, especially for early periods, and small city-states are often missing.</p>

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
