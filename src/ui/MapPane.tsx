import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { formatYear, parseHistDate } from '../model/dates';
import type { Category, Flow, FlowCause, Relation, Series, Territory, TimelineItem } from '../model/types';
import type { Area } from '../data/geo';
import { addPoint, canFinish, closePart, EMPTY_DRAFT, toGeometry, undo, type Draft } from './drawing';
import { activeRoutes, CAUSES, choroplethAt, mapKindOf } from './mapData';
import type { BackdropStatus, MapCamera, MapOptions } from './MapView';
import { formatValue } from './util';

// MapLibre is large; load it only when the map is first shown.
const MapView = lazy(() => import('./MapView'));

export type { MapCamera, MapOptions };

/** The Migration layer: shown or not, and causes Bob has filtered out. */
export interface FlowOptions { show: boolean; hiddenCauses: FlowCause[] }

interface Props {
  year: number;
  items: TimelineItem[];
  territories: Territory[];
  categories: Category[];
  relations: Relation[];
  series: Series[];
  flows: Flow[];
  flowOptions: FlowOptions;
  onFlowOptions: (o: FlowOptions) => void;
  dataSeriesId: string | null;
  onDataSeries: (id: string | null) => void;
  options: MapOptions;
  onOptions: (o: MapOptions) => void;
  fadeYears: number;
  selectedId?: string;
  onOpenItem: (id: string) => void;
  onOpenTerritory: (id: string) => void;
  onOpenFlow: (id: string) => void;
  onAddTerritory: () => void;
  camera: MapCamera;
  onCamera: (c: MapCamera) => void;
  /** Set while Bob is drawing a border on the map. */
  drawing?: { onDone: (g: Area) => void; onCancel: () => void };
  /** Set while Bob is picking one point on the map (a migration route's end). */
  picking?: { onDone: (p: [number, number]) => void; onCancel: () => void };
}

/** The map, its layers menu and its legend. The year bar lives outside, shared with the timeline. */
export function MapPane(p: Props) {
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  useEffect(() => setDraft(EMPTY_DRAFT), [p.drawing]);
  const [backdrop, setBackdrop] = useState<BackdropStatus>({ state: 'off' });
  const mapSeries = useMemo(() => p.series.filter((s) => mapKindOf(s)), [p.series]);
  const dataSeries = mapSeries.find((s) => s.id === p.dataSeriesId);
  const category = dataSeries && p.categories.find((c) => c.id === dataSeries.categoryId);
  const legend = dataSeries && mapKindOf(dataSeries) !== 'territories' ? choroplethAt(dataSeries, p.year) : null;
  const visibleCats = useMemo(() => new Set(p.categories.map((c) => c.id)), [p.categories]);
  const { show: showFlows, hiddenCauses } = p.flowOptions;
  const shownFlows = useMemo(
    () => (showFlows ? p.flows.filter((f) => visibleCats.has(f.categoryId) && !hiddenCauses.includes(f.cause)) : []),
    [p.flows, showFlows, hiddenCauses, visibleCats],
  );
  const routesNow = useMemo(() => activeRoutes(shownFlows, p.year, () => true), [shownFlows, p.year]);
  const causesNow = CAUSES.filter((c) => routesNow.some((r) => r.flow.cause === c.id));
  const toggleCause = (c: FlowCause) => p.onFlowOptions({ ...p.flowOptions, hiddenCauses: hiddenCauses.includes(c) ? hiddenCauses.filter((x) => x !== c) : [...hiddenCauses, c] });

  return (
    <section className="map-pane" aria-label="Map">
      <Suspense fallback={<div className="map-host map-loading" role="status">Loading the map…</div>}>
        <MapView
          year={p.year}
          items={p.items}
          territories={p.territories}
          categories={p.categories}
          relations={p.relations}
          flows={shownFlows}
          dataSeries={dataSeries}
          options={p.options}
          fadeYears={p.fadeYears}
          selectedId={p.selectedId}
          onOpenItem={p.onOpenItem}
          onOpenTerritory={p.onOpenTerritory}
          onOpenFlow={p.onOpenFlow}
          onBackdropStatus={setBackdrop}
          camera={p.camera}
          onCamera={p.onCamera}
          draft={p.drawing ? draft : undefined}
          onDrawPoint={p.drawing ? (pt, nearFirst) => setDraft((d) => (nearFirst ? closePart(d) : addPoint(d, pt))) : p.picking ? (pt) => p.picking!.onDone(pt) : undefined}
        />
      </Suspense>

      {p.picking ? (
        <div className="map-draw" role="toolbar" aria-label="Picking a place" data-testid="pick-toolbar">
          <span className="grow">Click on the map to place this end of the route.</span>
          <button className="btn small quiet" onClick={p.picking.onCancel}>Cancel</button>
        </div>
      ) : p.drawing ? (
        <div className="map-draw" role="toolbar" aria-label="Drawing a border" data-testid="draw-toolbar">
          <span className="grow">{draft.current.length ? 'Click the first point to close the outline, or Done.' : 'Click on the map to outline the border.'}</span>
          <button className="btn small" disabled={!draft.current.length && !draft.done.length} onClick={() => setDraft(undo)}>Undo point</button>
          <button className="btn small" disabled={draft.current.length < 3} onClick={() => setDraft(closePart)} title="For islands and other separate pieces">Add another part</button>
          <button className="btn small primary" disabled={!canFinish(draft)} onClick={() => { const g = toGeometry(draft); if (g) p.drawing!.onDone(g); }}>Done</button>
          <button className="btn small quiet" onClick={p.drawing.onCancel}>Cancel</button>
        </div>
      ) : (
      <div className="map-tools">
        <button className="btn small" aria-expanded={menu} onClick={() => setMenu(!menu)}>Layers</button>
        <button className="btn small" onClick={p.onAddTerritory}>Add a territory</button>
        {menu && (
          <div className="map-menu" role="group" aria-label="Map layers" data-testid="map-layers">
            <label className="field">
              <span>Color the map by</span>
              <select className="input" value={dataSeries?.id ?? ''} onChange={(e) => p.onDataSeries(e.target.value || null)}>
                <option value="">Nothing</option>
                {mapSeries.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              {mapSeries.length === 0 && <small className="hint">Import a trend from Our World in Data with “Every country” to color the map.</small>}
            </label>
            <label className="check"><input type="checkbox" checked={p.options.backdrop} onChange={(e) => p.onOptions({ ...p.options, backdrop: e.target.checked })} /> Show reference borders</label>
            <label className="check"><input type="checkbox" checked={p.options.keepPast} onChange={(e) => p.onOptions({ ...p.options, keepPast: e.target.checked })} /> Keep past entries on the map</label>
            <label className="check"><input type="checkbox" checked={p.options.connections} onChange={(e) => p.onOptions({ ...p.options, connections: e.target.checked })} /> Show connections</label>
            <label className="check"><input type="checkbox" checked={showFlows} onChange={(e) => p.onFlowOptions({ ...p.flowOptions, show: e.target.checked })} /> Migration</label>
            {showFlows && p.flows.length > 0 && (
              <fieldset className="cause-filter" aria-label="Migration causes">
                {CAUSES.filter((c) => p.flows.some((f) => f.cause === c.id)).map((c) => (
                  <label key={c.id} className="check" style={{ '--c': c.color } as React.CSSProperties}>
                    <input type="checkbox" checked={!hiddenCauses.includes(c.id)} onChange={() => toggleCause(c.id)} /> <span className="swatch" />{c.label}
                  </label>
                ))}
              </fieldset>
            )}
            {showFlows && p.flows.length === 0 && <small className="hint">Record a migration with Add → Migration on the map.</small>}
            <small className="hint">Reference borders come from the historical-basemaps project and aren’t saved in your timeline.</small>
          </div>
        )}
      </div>
      )}

      <div className="map-status">
        {backdrop.state === 'loading' && <div className="notice" role="status">Loading reference borders for {formatYear(backdrop.year)}…</div>}
        {backdrop.state === 'ready' && <div className="notice subtle">Reference borders: {formatYear(backdrop.year)}</div>}
        {backdrop.state === 'error' && <div className="notice bad" role="alert">{backdrop.message}</div>}
      </div>

      <div className="map-legends">
      {showFlows && shownFlows.length > 0 && (
        <div className="map-legend" data-testid="flow-legend">
          <strong>Migration</strong>
          {causesNow.length > 0 && (
            <ul className="cause-key">
              {causesNow.map((c) => <li key={c.id} style={{ '--c': c.color } as React.CSSProperties}><span className="swatch" />{c.label}</li>)}
            </ul>
          )}
          <small>
            {routesNow.length ? `${routesNow.length} ${routesNow.length === 1 ? 'route' : 'routes'} in ${formatYear(Math.floor(p.year))}. ` : `No migration routes in ${formatYear(Math.floor(p.year))}. `}
            {routesNow.some((r) => r.flow.measure === 'moved') && 'Moving dashes: people moving each year. '}
            {routesNow.some((r) => r.flow.measure === 'living') && 'Still arrows: people living abroad. '}
            {routesNow.length > 0 && 'Thicker means more people.'}
          </small>
        </div>
      )}
      {dataSeries && legend?.extent && (
        <div className="map-legend" data-testid="map-legend" style={{ '--c': category?.color } as React.CSSProperties}>
          <strong>{dataSeries.title}</strong>
          <div className="ramp" />
          <div className="ramp-labels">
            <span>{formatValue(legend.extent[0], dataSeries.unit)}</span>
            <span>{formatValue(legend.extent[1], dataSeries.unit)}</span>
          </div>
          <small>{legend.values.size ? `${legend.values.size} countries with data in ${formatYear(Math.floor(p.year))}` : `No data for ${formatYear(Math.floor(p.year))}`}. Shaded on today’s borders{dataSeries.scale === 'log' ? ', log scale' : ''}.</small>
        </div>
      )}
      </div>
    </section>
  );
}

const SPEEDS = [1, 5, 10, 25, 50, 100];

/** Current year control shared by the map and timeline: type a year, drag, or play. */
export function YearBar({ year, range, onYear, playing, onPlaying, speed, onSpeed }: {
  year: number;
  range: [number, number];
  onYear: (y: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = formatYear(Math.floor(year));
  const input = useRef<HTMLInputElement>(null);
  const bad = text !== null && text.trim() !== '' && !parseHistDate(text);

  useEffect(() => { if (playing) setText(null); }, [playing]);

  return (
    <div className="yearbar" data-testid="yearbar">
      <button className="btn small" onClick={() => onPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play through time'}>{playing ? 'Pause' : 'Play'}</button>
      <input
        ref={input}
        className="year-input"
        aria-label="Year"
        aria-invalid={bad}
        value={text ?? shown}
        onFocus={(e) => { setText(shown); e.target.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setText(null); input.current?.blur(); }
          if (e.key !== 'Enter') return;
          const d = text ? parseHistDate(text) : null;
          if (d) { onYear(d.y); setText(null); input.current?.blur(); }
        }}
        title="Type a year, like 490 BCE or 1914"
      />
      <input
        type="range"
        className="grow"
        aria-label="Move through time"
        min={range[0]}
        max={range[1]}
        step={1}
        value={Math.min(range[1], Math.max(range[0], Math.floor(year)))}
        onChange={(e) => onYear(Number(e.target.value))}
      />
      <label className="speed">
        <span className="sr-only">Speed</span>
        <select className="input" value={speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="Speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s} {s === 1 ? 'year' : 'years'}/s</option>)}
        </select>
      </label>
    </div>
  );
}
