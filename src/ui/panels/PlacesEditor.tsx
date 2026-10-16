import { useRef, useState } from 'react';
import { lookUpPlace, type PlaceResult } from '../../media/wikipedia';
import { coordsText, formatCoords, parseCoords, placeLabel } from '../../model/places';
import type { ItemKind, Place } from '../../model/types';
import { Field } from '../fields';
import type { Nav } from '../nav';

const OFFLINE = 'You’re offline. Looking up a place needs a connection; you can still type its coordinates or pick it on the map.';

const ROLE_CHOICES: Array<{ role: NonNullable<Place['role']>; label: string }> = [
  { role: 'born', label: 'Born here' },
  { role: 'died', label: 'Died here' },
  { role: 'site', label: 'Another place in their life' },
];

interface FormState {
  /** Which place is being edited; null for a new one. */
  index: number | null;
  name: string;
  coords: string;
  role: NonNullable<Place['role']>;
}

/** The entry editor's places: where it happened, or where a person was born and died. Each one is a pin on the map. */
export function PlacesEditor({ places, kind, onChange, nav }: {
  places: Place[];
  kind: ItemKind;
  onChange: (places: Place[] | undefined) => void;
  nav: Nav;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const isPerson = kind === 'person';

  const startForm = (index: number | null) => {
    const pl = index === null ? undefined : places[index];
    setForm({
      index,
      name: pl?.name ?? '',
      coords: pl ? coordsText(pl) : '',
      role: pl?.role ?? (isPerson && !places.some((p) => p.role === 'born') ? 'born' : 'site'),
    });
    setResults(null);
    setError(null);
  };
  const closeForm = () => { abort.current?.abort(); setForm(null); setResults(null); setError(null); setBusy(false); };
  const edit = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const lookUp = async () => {
    if (!form?.name.trim()) return;
    if (!navigator.onLine) { setError(OFFLINE); return; }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      setResults(await lookUpPlace(form.name.trim(), ctrl.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(navigator.onLine ? (e as Error).message : OFFLINE);
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  const parsed = form ? parseCoords(form.coords) : undefined;
  const badCoords = !!form?.coords.trim() && !parsed;

  const savePlace = () => {
    if (!form || !parsed) return;
    const name = form.name.trim();
    const pl: Place = { ...(name ? { name } : {}), ...parsed, role: isPerson ? form.role : 'site' };
    onChange(form.index === null ? [...places, pl] : places.map((p, i) => (i === form.index ? pl : p)));
    closeForm();
  };
  const removePlace = (i: number) => {
    const next = places.filter((_, j) => j !== i);
    onChange(next.length ? next : undefined);
    if (form?.index === i) closeForm();
  };

  return (
    <>
      <h3>Places</h3>
      <div className="editor-list" data-testid="places-list">
        {places.map((pl, i) => (
          <div className="editor-row" key={i}>
            <span className="grow">{placeLabel(pl)}</span>
            <button type="button" className="btn small quiet" onClick={() => startForm(i)}>Edit</button>
            <button type="button" className="btn small quiet" onClick={() => removePlace(i)}>Remove</button>
          </div>
        ))}
      </div>
      {!form && (
        <button type="button" className="btn small" onClick={() => startForm(null)}>Add a place</button>
      )}
      {form && (
        <div className="place-form" data-testid="place-form">
          <div className="editor-row beside-input">
            <div className="grow">
              <Field label="Place name">
                <input
                  value={form.name}
                  onChange={(e) => edit({ name: e.target.value })}
                  // Inside the entry's form: Enter looks the place up instead of saving the entry.
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookUp(); } }}
                  placeholder="e.g. Salamis"
                  autoFocus
                />
              </Field>
            </div>
            <button type="button" className="btn" onClick={() => void lookUp()} disabled={!form.name.trim() || busy}>Look up</button>
          </div>
          {busy && <div className="notice" role="status">Looking on Wikipedia…</div>}
          {error && <div className="notice bad" role="alert">{error}</div>}
          {results && results.length === 0 && <div className="notice">No places on Wikipedia match “{form.name.trim()}”. Type the coordinates or pick it on the map.</div>}
          {results && results.length > 0 && (
            <ul className="linklist" data-testid="place-results" aria-label="Places found">
              {results.map((r) => (
                <li key={`${r.name}-${r.lat}-${r.lon}`}>
                  <button type="button" onClick={() => { edit({ coords: coordsText(r) }); setResults(null); }}>
                    <strong>{r.name}</strong>
                    <small>{[r.description, formatCoords(r)].filter(Boolean).join(' · ')}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="editor-row beside-input">
            <div className="grow">
              <Field
                label="Coordinates"
                hint={badCoords ? 'I can’t read these. Latitude first, like 37.97, 23.72 or 37°58′N 23°43′E.' : parsed ? formatCoords(parsed) : 'Latitude, longitude, like 37.97, 23.72 or 37°58′N 23°43′E.'}
                hintTone={badCoords ? 'bad' : undefined}
              >
                <input inputMode="decimal" value={form.coords} onChange={(e) => edit({ coords: e.target.value })} placeholder="37.97, 23.72" />
              </Field>
            </div>
            <button type="button" className="btn" onClick={() => nav.pick(([lon, lat]) => edit({ coords: coordsText({ lat, lon }) }))}>Pick on the map</button>
          </div>
          {isPerson && (
            <Field label="What happened here">
              <select value={form.role} onChange={(e) => edit({ role: e.target.value as FormState['role'] })}>
                {ROLE_CHOICES.map((c) => <option key={c.role} value={c.role}>{c.label}</option>)}
              </select>
            </Field>
          )}
          <div className="editor-row">
            <button type="button" className="btn small primary" onClick={savePlace} disabled={!parsed}>{form.index === null ? 'Add place' : 'Save place'}</button>
            <button type="button" className="btn small quiet" onClick={closeForm}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
