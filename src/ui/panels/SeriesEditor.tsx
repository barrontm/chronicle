import { useState } from 'react';
import { newId, notesFor, remove, upsert, validateSeries } from '../../model/doc';
import type { Series } from '../../model/types';
import { owidCsvUrl, parseOwidCsv, parsePointsText, parseWorldBankJson, pointsToText, type TrendTable } from '../../data/seriesText';
import { SOURCE_NAMES, dataUrl, pageUrl, type TrendIndex, type TrendRef } from '../../data/trendCatalog';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import type { Nav } from '../nav';
import { TrendSearch } from './TrendSearch';

/**
 * Create or edit a trend: search Our World in Data and the World Bank, paste an
 * Our World in Data chart link, or type "year, value" pairs.
 */
const EVERY_COUNTRY = '__every_country__';

interface Found { table: TrendTable; url: string; sourceName: string; entity: string; indicator: string; ref?: TrendRef }

export function SeriesEditor({ id, nav }: { id: string | null; nav: Nav }) {
  const { doc, update } = useDoc();
  const existing = id ? doc.series.find((s) => s.id === id) : undefined;
  const [d, setD] = useState<Series>(existing ?? {
    id: newId('sr'), title: '', unit: '', categoryId: doc.categories.find((c) => c.id === 'society')?.id ?? doc.categories[0]?.id ?? '',
    scale: 'linear', points: [], updatedAt: 0,
  });
  const [text, setText] = useState(existing ? pointsToText(existing.points) : '');
  const [owidUrl, setOwidUrl] = useState('');
  /** A fetched dataset waiting for Bob to choose a country and measure. */
  const [owid, setOwid] = useState<Found | null>(null);
  const [owidError, setOwidError] = useState<string | null>(null);
  /** What's being fetched: 'link' for a pasted link, or a search result's key. */
  const [busy, setBusy] = useState<string | null>(null);
  const territoryIds = new Set(doc.territories.map((t) => t.id));
  // Typed values can belong to one of your territories, which then gets a sized circle on the map.
  const [place, setPlace] = useState(() => Object.keys(existing?.regions ?? {}).find((k) => territoryIds.has(k)) ?? '');
  const set = <K extends keyof Series>(k: K, v: Series[K]) => setD((x) => ({ ...x, [k]: v }));

  const parsed = parsePointsText(text);
  const countryRegions = Object.fromEntries(Object.entries(d.regions ?? {}).filter(([k]) => !territoryIds.has(k)));
  const regions = place ? { ...countryRegions, [place]: parsed.points } : countryRegions;
  const hasRegions = Object.keys(regions).length > 0;
  const candidate: Series = { ...d, title: d.title.trim(), points: parsed.points, regions: hasRegions ? regions : undefined };
  const problems = text.trim() || hasRegions ? [...parsed.errors, ...validateSeries(candidate, new Set(doc.categories.map((c) => c.id)))] : [];
  const canSave = !!candidate.title && parsed.errors.length === 0 && problems.length === 0 && (parsed.points.length >= 2 || hasRegions);
  const countryCount = Object.keys(countryRegions).length;
  const notes = existing ? notesFor(doc, existing.id) : [];

  const fetchTable = async (key: string, sourceName: string, load: () => Promise<{ table: TrendTable; url: string; ref?: TrendRef }>) => {
    setOwidError(null);
    setBusy(key);
    try {
      const { table, url, ref } = await load();
      const entity = table.entities.includes('World') ? 'World' : table.entities[0];
      setOwid({ table, url, sourceName, entity, indicator: table.indicators[0], ref });
    } catch (e) {
      setOwidError(navigator.onLine ? (e as Error).message : `You’re offline. Getting numbers from ${sourceName} needs a connection.`);
    } finally {
      setBusy(null);
    }
  };

  const fetchOwid = () => fetchTable('link', SOURCE_NAMES.owid, async () => {
    const res = await fetch(owidCsvUrl(owidUrl));
    if (!res.ok) throw new Error(`Our World in Data returned ${res.status}. Check the link.`);
    return { table: parseOwidCsv(await res.text()), url: owidUrl.trim() };
  });

  const fetchFound = (ref: TrendRef, index: TrendIndex) => fetchTable(`${ref.s}:${ref.id}`, SOURCE_NAMES[ref.s], async () => {
    const res = await fetch(dataUrl(ref));
    if (!res.ok) throw new Error(`${SOURCE_NAMES[ref.s]} returned ${res.status}. Try again later.`);
    const table = ref.s === 'owid' ? parseOwidCsv(await res.text()) : parseWorldBankJson(await res.json(), index.wbAggregates);
    return { table, url: pageUrl(ref), ref };
  });

  /** Name, unit and source from the chosen dataset, without overwriting what Bob typed. */
  const fromFound = (x: Series, f: Found, title: string): Series => ({
    ...x,
    title: x.title || title,
    unit: x.unit || f.ref?.u || '',
    source: { name: f.sourceName, url: f.url },
  });

  const useOwid = () => {
    if (!owid) return;
    if (owid.entity === EVERY_COUNTRY) {
      const world = owid.table.entities.includes('World') ? owid.table.pointsFor('World', owid.indicator) : [];
      setText(pointsToText(world));
      setD((x) => ({ ...fromFound(x, owid, owid.ref?.t ?? owid.indicator), regions: owid.table.countriesFor(owid.indicator) }));
      setOwid(null);
      return;
    }
    const pts = owid.table.pointsFor(owid.entity, owid.indicator);
    setText(pointsToText(pts));
    setD((x) => fromFound(x, owid, `${owid.ref?.t ?? owid.indicator}${owid.entity !== 'World' ? ` (${owid.entity})` : ''}`));
    setOwid(null);
  };

  /** Search, or paste a link, then choose a country: first for a new trend, after the details when editing. */
  const find = (
    <>
      <h3>Find a trend</h3>
      <p className="hint" style={{ color: 'var(--muted)', marginTop: 0 }}>Search thousands of datasets from Our World in Data and the World Bank: population, economy, migration, health, technology.</p>
      <TrendSearch busyId={busy} onPick={(r, index) => void fetchFound(r, index)} />
      <h4>Or paste an Our World in Data chart link</h4>
      <div className="editor-row">
        <input className="input grow" type="url" value={owidUrl} onChange={(e) => setOwidUrl(e.target.value)} placeholder="https://ourworldindata.org/grapher/population" aria-label="Our World in Data chart link" />
        <button type="button" className="btn small" disabled={!owidUrl.trim() || !!busy} onClick={() => void fetchOwid()}>{busy === 'link' ? 'Fetching…' : 'Fetch'}</button>
      </div>
      {owidError && <div className="notice bad" role="alert">{owidError}</div>}
      {owid && (
        <div className="notice" style={{ background: 'var(--bg)' }} data-testid="owid-choose">
          <strong>{owid.ref?.t ?? owid.indicator}</strong> · <small>{owid.sourceName}</small>
          <div className="row">
            <Field label="Country or region">
              <select value={owid.entity} onChange={(e) => setOwid({ ...owid, entity: e.target.value })}>
                <option value={EVERY_COUNTRY}>Every country (colors the map)</option>
                {owid.table.entities.map((e) => <option key={e}>{e}</option>)}
              </select>
            </Field>
            {owid.table.indicators.length > 1 && (
              <Field label="Measure">
                <select value={owid.indicator} onChange={(e) => setOwid({ ...owid, indicator: e.target.value })}>
                  {owid.table.indicators.map((i) => <option key={i}>{i}</option>)}
                </select>
              </Field>
            )}
          </div>
          <button type="button" className="btn small primary" onClick={useOwid}>
            {owid.entity === EVERY_COUNTRY
              ? `Use data for ${Object.keys(owid.table.countriesFor(owid.indicator)).length} countries`
              : `Use ${owid.table.pointsFor(owid.entity, owid.indicator).length} data points`}
          </button>
        </div>
      )}
    </>
  );

  return (
    <form data-testid="series-editor" onSubmit={(e) => {
      e.preventDefault();
      if (!canSave) return;
      update((doc) => upsert(doc, 'series', candidate));
      nav.back();
    }}>
      <h2>{existing ? 'Edit trend' : 'New trend'}</h2>
      <p className="hint" style={{ color: 'var(--muted)', marginTop: 0 }}>A quantity measured over time. It’s drawn as a strip under your timeline and moves with it.</p>
      {!existing && find}
      <Field label="Name"><input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="World population" required /></Field>
      <div className="row">
        <Field label="Unit"><input value={d.unit} onChange={(e) => set('unit', e.target.value)} placeholder="people, %, tonnes…" /></Field>
        <Field label="Category">
          <select value={d.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Scale" hint="Log scale suits things that grow by multiples, like computing power.">
        <div className="segmented" role="group">
          <button type="button" aria-pressed={d.scale === 'linear'} onClick={() => set('scale', 'linear')}>Linear</button>
          <button type="button" aria-pressed={d.scale === 'log'} onClick={() => set('scale', 'log')}>Log</button>
        </div>
      </Field>
      {existing && find}

      <h3>Data</h3>
      {countryCount > 0 && (
        <div className="notice" data-testid="country-data">
          Values for {countryCount} countries color the map.{' '}
          <button type="button" className="btn small quiet" onClick={() => set('regions', undefined)}>Remove country values</button>
        </div>
      )}
      {doc.territories.length > 0 && (
        <Field label="These values are for" hint={place ? 'Drawn as a circle on that territory, sized by the value.' : undefined}>
          <select value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">{countryCount ? 'The whole world (the strip)' : 'No particular place'}</option>
            {doc.territories.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
      )}
      <Field label="One “year, value” per line" hint={parsed.points.length ? `${parsed.points.length} points read` : countryCount ? 'Optional: a world total to draw as a strip' : 'Years can be BCE: “500 BCE, 100”'} hintTone={parsed.points.length >= 2 ? 'ok' : undefined}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} style={{ fontFamily: 'var(--font-ui)', fontSize: 13 }} placeholder={'1800, 990000000\n1900, 1650000000\n1950, 2500000000'} />
      </Field>
      {problems.length > 0 && <div className="notice bad">{problems.slice(0, 4).map((p) => <div key={p}>{p}</div>)}</div>}
      <div className="row">
        <Field label="Source"><input value={d.source?.name ?? ''} onChange={(e) => set('source', e.target.value ? { ...d.source, name: e.target.value } : undefined)} placeholder="Where the numbers come from" /></Field>
        <Field label="Source link"><input type="url" value={d.source?.url ?? ''} onChange={(e) => set('source', { name: d.source?.name ?? '', url: e.target.value || undefined })} /></Field>
      </div>

      {existing && (
        <>
          <h3>Notes</h3>
          <ul className="linklist">
            {notes.map((n) => <li key={n.id}><button type="button" onClick={() => nav.open({ type: 'note', id: n.id })}><strong>{n.title}</strong></button></li>)}
          </ul>
          <button type="button" className="btn small" onClick={() => nav.open({ type: 'new-note', linkedIds: [existing.id] })}>Write a note</button>
        </>
      )}

      <div className="actions">
        <button className="btn primary" disabled={!canSave}>{existing ? 'Save changes' : 'Add trend'}</button>
        <button type="button" className="btn" onClick={() => nav.back()}>Cancel</button>
        {existing && (
          <button type="button" className="btn danger" onClick={() => {
            if (confirm(`Delete the trend “${existing.title}”?`)) { update((doc) => remove(doc, 'series', existing.id)); nav.back(); }
          }}>Delete</button>
        )}
      </div>
    </form>
  );
}
