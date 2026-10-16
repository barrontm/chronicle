import { useEffect, useId, useState } from 'react';
import { loadCountries, type CountryPlace } from '../../data/countries';
import { parsePointsText, pointsToText } from '../../data/seriesText';
import { newId, notesFor, remove, upsert } from '../../model/doc';
import type { Flow, FlowEnd, FlowMeasure, TimelineDoc } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import { aboutPeople, CAUSES, causeOf, routeYears } from '../mapData';
import type { Nav } from '../nav';
import { titleOf } from '../util';
import { LinkedEntry } from './TerritoryPanels';

/** The bundled list of countries, for naming and picking route ends. Null until loaded. */
function useCountries(): { list: CountryPlace[] | null; error: string | null } {
  const [list, setList] = useState<CountryPlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadCountries().then((l) => { if (live) setList(l); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  return { list, error };
}

export function endName(end: FlowEnd, doc: TimelineDoc, countries: CountryPlace[] | null): string {
  if ('country' in end) return countries?.find((c) => c.code === end.country)?.name ?? end.country;
  if ('territoryId' in end) return doc.territories.find((t) => t.id === end.territoryId)?.title ?? 'Missing territory';
  return end.name;
}

const MEASURE_LABEL: Record<FlowMeasure, string> = { moved: 'People moving each year', living: 'People living abroad' };

const firstYear = (f: Flow) => Math.min(...f.routes.flatMap((r) => r.points.map((p) => Math.floor(p.x))));

export function FlowView({ id, nav }: { id: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const { list: countries } = useCountries();
  const f = doc.flows.find((x) => x.id === id);
  if (!f) return <div className="notice">This migration was deleted.</div>;
  const cause = causeOf(f.cause);
  const notes = notesFor(doc, id);
  const start = firstYear(f);
  return (
    <article data-testid="flow-view">
      <h2>{f.title}</h2>
      <div className="meta">
        <span style={{ '--c': cause.color } as React.CSSProperties}><span className="swatch" />{cause.label}</span>
        <span>{MEASURE_LABEL[f.measure]}</span>
      </div>
      {f.itemId && (
        <p>On your timeline: <button className="btn small quiet" onClick={() => nav.open({ type: 'item', id: f.itemId! })}>{titleOf(doc, f.itemId) ?? 'Missing entry'}</button></p>
      )}
      {f.note && <p className="prose">{f.note}</p>}

      <h3>Routes</h3>
      <ul className="linklist" data-testid="flow-routes">
        {f.routes.map((r, i) => {
          const peak = Math.max(0, ...r.points.map((p) => p.v));
          return (
            <li key={i}>
              <button onClick={() => r.points[0] && nav.showOnMap(Math.floor(Math.min(...r.points.map((p) => p.x))))}>
                <strong>{endName(r.from, doc, countries)} → {endName(r.to, doc, countries)}</strong>
                <small>{routeYears(r.points)} · up to {aboutPeople(peak)}{f.measure === 'moved' ? ' a year' : ' living there'}</small>
              </button>
            </li>
          );
        })}
      </ul>

      <h3>Notes</h3>
      <ul className="linklist">
        {notes.map((n) => <li key={n.id}><button onClick={() => nav.open({ type: 'note', id: n.id })}><strong>{n.title}</strong></button></li>)}
      </ul>
      <button className="btn small" onClick={() => nav.open({ type: 'new-note', linkedIds: [id] })}>Write a note</button>

      {f.source && (
        <p className="lede" style={{ marginTop: 16 }}>
          Numbers from {f.source.url ? <a href={f.source.url} target="_blank" rel="noreferrer">{f.source.name}</a> : f.source.name}.
        </p>
      )}

      <div className="actions">
        <button className="btn primary" onClick={() => nav.replace({ type: 'flow', id, edit: true })}>Edit</button>
        {Number.isFinite(start) && <button className="btn" onClick={() => nav.showOnMap(start)}>Show on map</button>}
        <button className="btn danger" onClick={() => {
          if (confirm(`Delete the migration “${f.title}”? Notes about it are kept.`)) {
            update((d) => remove(d, 'flows', id));
            nav.close();
          }
        }}>Delete</button>
      </div>
    </article>
  );
}

/** A route being edited: its ends (unset until complete) and its numbers as typed. */
interface RouteRow { k: string; from?: FlowEnd; to?: FlowEnd; text: string }

export function FlowEditor({ id, itemId, nav }: { id: string | null; itemId?: string; nav: Nav }) {
  const { doc, update } = useDoc();
  const { list: countries, error: countriesError } = useCountries();
  const listId = useId();
  const existing = id ? doc.flows.find((x) => x.id === id) : undefined;
  const [d, setD] = useState<Flow>(() => existing ?? {
    id: newId('f'), title: '', cause: 'unknown', measure: 'moved', itemId, routes: [], updatedAt: 0,
    categoryId: doc.categories.find((c) => c.id === 'society')?.id ?? doc.categories[0]?.id ?? '',
  });
  const [rows, setRows] = useState<RouteRow[]>(() =>
    existing ? existing.routes.map((r) => ({ k: newId('r'), from: r.from, to: r.to, text: pointsToText(r.points) })) : [{ k: newId('r'), text: '' }]);
  if (id && !existing) return <div className="notice">This migration was deleted.</div>;

  const set = <K extends keyof Flow>(k: K, v: Flow[K]) => setD({ ...d, [k]: v });
  const setRow = (k: string, change: Partial<RouteRow>) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...change } : r)));
  const parsed = rows.map((r) => parsePointsText(r.text));
  const rowProblem = (i: number): string | null => {
    const r = rows[i];
    const p = parsed[i];
    if (!r.from || !r.to) return 'Choose where people left and where they went.';
    if (p.errors.length) return p.errors[0];
    if (!p.points.length) return 'Add at least one year and number.';
    if (p.points.some((pt) => pt.v < 0)) return 'Numbers can’t be negative.';
    return null;
  };
  const valid = !!d.title.trim() && rows.length > 0 && rows.every((_, i) => !rowProblem(i));
  const amountLabel = d.measure === 'moved' ? 'People moving each year' : 'People living there';

  return (
    <form data-testid="flow-editor" onSubmit={(e) => {
      e.preventDefault();
      if (!valid) return;
      const flow: Flow = {
        ...d,
        title: d.title.trim(),
        note: d.note?.trim() || undefined,
        source: d.source?.name.trim() ? { name: d.source.name.trim(), url: d.source.url?.trim() || undefined } : undefined,
        routes: rows.map((r, i) => ({ from: r.from!, to: r.to!, points: parsed[i].points })),
      };
      update((doc) => upsert(doc, 'flows', flow));
      nav.replace({ type: 'flow', id: flow.id });
      if (!existing) nav.showOnMap(firstYear(flow));
    }}>
      <h2>{existing ? 'Edit migration' : 'Add a migration'}</h2>
      <p className="lede">People moving between places, drawn on the map as arrows: thicker for more people, colored by cause.</p>
      <Field label="Name"><input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Irish famine emigration" required autoFocus /></Field>
      <div className="row">
        <Field label="Cause">
          <select value={d.cause} onChange={(e) => set('cause', e.target.value as Flow['cause'])}>
            {CAUSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select value={d.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="The numbers are" hint={d.measure === 'moved' ? 'Shown with dashes moving toward where people went.' : 'Shown as a still arrow, so it’s never mistaken for people on the move.'}>
        <select value={d.measure} onChange={(e) => set('measure', e.target.value as FlowMeasure)}>
          <option value="moved">People moving each year</option>
          <option value="living">People living abroad</option>
        </select>
      </Field>
      <LinkedEntry value={d.itemId} onChange={(v) => set('itemId', v)} hint="Optional: the event or period this migration belongs to, like a famine or a war." />

      <h3>Routes</h3>
      {countriesError && <div className="notice bad" role="alert">{countriesError} Territories and places on the map still work.</div>}
      <datalist id={listId}>{countries?.map((c) => <option key={c.code} value={c.name} />)}</datalist>
      <div className="editor-list">
        {rows.map((r, i) => {
          const problem = rowProblem(i);
          return (
            <fieldset className="snapshot" key={r.k} aria-label={`Route ${i + 1}`}>
              <EndPicker label="From" value={r.from} onChange={(from) => setRow(r.k, { from })} countries={countries} listId={listId} nav={nav} />
              <EndPicker label="To" value={r.to} onChange={(to) => setRow(r.k, { to })} countries={countries} listId={listId} nav={nav} />
              <Field label={amountLabel} hint="One line per year, like 1846, 130000. Years in between are filled in; outside them the route isn’t drawn.">
                <textarea rows={3} value={r.text} onChange={(e) => setRow(r.k, { text: e.target.value })} placeholder={'1846, 130000\n1855, 130000'} />
              </Field>
              <div className="editor-row">
                <small className={`grow hint ${problem && r.text.trim() ? 'bad' : ''}`}>{r.text.trim() ? problem ?? '' : ''}</small>
                {rows.length > 1 && <button type="button" className="btn small quiet" onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))}>Remove route</button>}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, { k: newId('r'), from: rs.at(-1)?.from, text: '' }])}>Add another route</button>
      </div>

      <h3>Where the numbers come from</h3>
      <div className="row">
        <Field label="Source"><input value={d.source?.name ?? ''} onChange={(e) => set('source', { ...d.source, name: e.target.value })} placeholder="e.g. Kenny, The Great Irish Famine" /></Field>
        <Field label="Link" hint="Optional"><input value={d.source?.url ?? ''} onChange={(e) => set('source', { name: d.source?.name ?? '', url: e.target.value })} /></Field>
      </div>
      <Field label="Note" hint="How sure the numbers are, who went, why."><textarea rows={3} value={d.note ?? ''} onChange={(e) => set('note', e.target.value)} /></Field>

      <div className="actions">
        <button className="btn primary" disabled={!valid}>{existing ? 'Save changes' : 'Add to map'}</button>
        <button type="button" className="btn" onClick={() => (existing ? nav.replace({ type: 'flow', id: existing.id }) : nav.back())}>Cancel</button>
      </div>
    </form>
  );
}

type EndMode = 'country' | 'territory' | 'place';

const modeOf = (e?: FlowEnd): EndMode => (!e || 'country' in e ? 'country' : 'territoryId' in e ? 'territory' : 'place');

/** One end of a route: a country by name, one of Bob's territories, or a named point picked on the map. */
function EndPicker({ label, value, onChange, countries, listId, nav }: {
  label: string;
  value?: FlowEnd;
  onChange: (e: FlowEnd | undefined) => void;
  countries: CountryPlace[] | null;
  listId: string;
  nav: Nav;
}) {
  const { doc } = useDoc();
  const [mode, setMode] = useState<EndMode>(modeOf(value));
  const [countryText, setCountryText] = useState('');
  const [place, setPlace] = useState(() => (value && 'lon' in value ? { name: value.name, lat: String(value.lat), lon: String(value.lon) } : { name: '', lat: '', lon: '' }));
  // Show the country's name once the list has loaded.
  const code = value && 'country' in value ? value.country : '';
  useEffect(() => {
    if (code && countries) setCountryText(countries.find((c) => c.code === code)?.name ?? code);
  }, [code, countries]);

  const findCountry = (text: string) => {
    const t = text.trim().toLowerCase();
    return countries?.find((c) => c.name.toLowerCase() === t || c.code.toLowerCase() === t);
  };
  const pickCountry = (text: string) => {
    setCountryText(text);
    const hit = findCountry(text);
    onChange(hit ? { country: hit.code } : undefined);
  };
  // Text typed before the list finished loading is matched once it arrives.
  useEffect(() => {
    if (countries && mode === 'country' && !code && countryText.trim()) pickCountry(countryText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries]);
  const setPoint = (p: typeof place) => {
    setPlace(p);
    const [lat, lon] = [Number(p.lat), Number(p.lon)];
    const ok = p.name.trim() && p.lat.trim() && p.lon.trim() && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    onChange(ok ? { name: p.name.trim(), lat, lon } : undefined);
  };
  const unknownCountry = mode === 'country' && countryText.trim() && countries && !value;

  return (
    <div className="flow-end">
      <Field label={label}>
        <select value={mode} onChange={(e) => { setMode(e.target.value as EndMode); onChange(undefined); setCountryText(''); }}>
          <option value="country">A country</option>
          <option value="territory">One of your territories</option>
          <option value="place">A place on the map</option>
        </select>
      </Field>
      {mode === 'country' && (
        <Field label={`${label} country`} hint={unknownCountry ? 'Pick a country from the list (today’s names).' : undefined} hintTone={unknownCountry ? 'bad' : undefined}>
          <input list={listId} value={countryText} onChange={(e) => pickCountry(e.target.value)} placeholder="Start typing a country" />
        </Field>
      )}
      {mode === 'territory' && (
        <Field label={`${label} territory`} hint={doc.territories.length ? 'Drawn where its borders are in the year shown.' : 'You have no territories yet. Add one from the map.'}>
          <select value={value && 'territoryId' in value ? value.territoryId : ''} onChange={(e) => onChange(e.target.value ? { territoryId: e.target.value } : undefined)}>
            <option value="">Choose…</option>
            {doc.territories.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
      )}
      {mode === 'place' && (
        <>
          <Field label={`${label} place name`}><input value={place.name} onChange={(e) => setPoint({ ...place, name: e.target.value })} placeholder="e.g. Corinth" /></Field>
          <div className="editor-row">
            <Field label="Latitude"><input inputMode="decimal" value={place.lat} onChange={(e) => setPoint({ ...place, lat: e.target.value })} style={{ width: 90 }} /></Field>
            <Field label="Longitude"><input inputMode="decimal" value={place.lon} onChange={(e) => setPoint({ ...place, lon: e.target.value })} style={{ width: 90 }} /></Field>
            <button type="button" className="btn small" onClick={() => nav.pick(([lon, lat]) => setPoint({ ...place, lat: String(Math.round(lat * 1e4) / 1e4), lon: String(Math.round(lon * 1e4) / 1e4) }))}>Pick on the map</button>
          </div>
        </>
      )}
    </div>
  );
}
