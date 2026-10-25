import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { formatYear, parseHistDate } from '../model/dates';
import type { Category, Flow, FlowCause, Region, Relation, Series, Territory, TimelineItem } from '../model/types';
import type { Area } from '../data/geo';
import { addPoint, canDelete, canFinish, closePart, deleteVertex, EMPTY_DRAFT, insertVertex, moveVertex, toGeometry, undo, type Draft, type Vertex } from './drawing';
import { polityMembers, worldMembers } from '../model/polities';
import { entryLanes } from '../model/lanes';
import { loadCountriesFile } from '../data/countries';
import { eraRegions } from '../model/eras';
import { activeRoutes, CAUSES, choroplethAt, eraExtents, followAt, landRings, mapKindOf, type ContactHow, type TimelineFocus } from './mapData';
import type { BackdropStatus, MapCamera, MapFit, MapOptions, ShapeEdit } from './MapView';
import { formatValue } from './util';

// MapLibre is large; load it only when the map is first shown.
const MapView = lazy(() => import('./MapView'));

export type { MapCamera, MapFit, MapOptions };

/** The Migration layer: shown or not, and causes Bob has filtered out. */
export interface FlowOptions { show: boolean; hiddenCauses: FlowCause[] }

interface Props {
  year: number;
  /** While Play runs, the years a change of borders morphs over (`bordersAt`); 0 when paused. */
  morphYears?: number;
  items: TimelineItem[];
  territories: Territory[];
  /** Bob's region records: their outlines are focused, and tint their eras. */
  regions?: Region[];
  categories: Category[];
  relations: Relation[];
  series: Series[];
  flows: Flow[];
  /** AI-drafted entries waiting for review, drawn as dashed pins. */
  draftItems: TimelineItem[];
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
  /** Fit the map to [west, south, east, north]; a new `at` fits again. */
  fitTo?: MapFit;
  /** Set while Bob is drawing a border on the map. */
  drawing?: { onDone: (g: Area) => void; onCancel: () => void };
  /** Set while Bob is changing a border's points on the map. */
  reshaping?: { geometry: Area; onDone: (g: Area) => void; onCancel: () => void };
  /** Set while Bob is picking one point on the map (a migration route's end). */
  picking?: { onDone: (p: [number, number]) => void; onCancel: () => void };
  /** The reader layout: the map follows what the overview has picked or open, in the years in view. */
  focus?: TimelineFocus;
  window?: { start: number; end: number };
  /** The region Bob clicked (through one of its territories); clicking a territory with a region focuses it. */
  region?: MapRegion;
  onRegion?: (r: MapRegion | undefined) => void;
  /** "Show all threads": every connection as a faint arc while it lasts. */
  allThreads?: boolean;
}

export interface MapRegion { name: string; territoryId?: string }

/** The map, its layers menu and its legend. The year bar lives outside, shared with the timeline. */
export function MapPane(p: Props) {
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  useEffect(() => setDraft(EMPTY_DRAFT), [p.drawing]);
  // Changing a border: the shape so far, the shapes before each change (for Undo), and the picked point.
  const [shape, setShape] = useState<{ g: Area; undo: Area[]; picked?: Vertex } | null>(null);
  const reshapeFrom = p.reshaping?.geometry;
  useEffect(() => setShape(reshapeFrom ? { g: reshapeFrom, undo: [] } : null), [reshapeFrom]);
  const onShapeEdit = (e: ShapeEdit) => setShape((s) => {
    if (!s) return s;
    if (e.type === 'pick') return { ...s, picked: e.at };
    if (e.type === 'insert') return { g: insertVertex(s.g, e.after, e.p), undo: [...s.undo, s.g], picked: { ...e.after, i: e.after.i + 1 } };
    return { g: moveVertex(s.g, e.at, e.p), undo: e.first ? [...s.undo, s.g] : s.undo, picked: e.at };
  });
  const undoShape = () => setShape((s) => (s?.undo.length ? { g: s.undo.at(-1)!, undo: s.undo.slice(0, -1) } : s));
  const deletePoint = () => setShape((s) => (s?.picked && canDelete(s.g, s.picked) ? { g: deleteVertex(s.g, s.picked), undo: [...s.undo, s.g] } : s));
  // Delete or Backspace removes the picked point (unless Bob is typing somewhere).
  const reshapingNow = !!shape;
  useEffect(() => {
    if (!reshapingNow) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      deletePoint();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reshapingNow]);
  // Morphs run only while playing, and never with reduced motion.
  const morphYears = p.morphYears && !matchMedia('(prefers-reduced-motion: reduce)').matches ? p.morphYears : 0;
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
  // Following the overview: what's picked, its contacts in the year, an open lane's layer, a clicked region.
  const following = !!p.onRegion;
  const follow = useMemo(() => (following ? followAt({
    items: p.items, territories: p.territories, relations: p.relations, flows: p.flows,
    focus: p.focus ?? {}, region: p.region?.name, regions: p.regions, year: p.year, window: p.window ?? { start: p.year - 50, end: p.year + 50 },
    worldMembers: (id) => worldMembers(id, { relations: p.relations }), morphYears,
  }) : undefined), [following, p.items, p.territories, p.regions, p.relations, p.flows, p.focus, p.region?.name, p.year, p.window, morphYears]);
  // Each region's era of the year, tinted over its extent.
  const [land, setLand] = useState<ReturnType<typeof landRings> | null>(null);
  useEffect(() => {
    let live = true;
    loadCountriesFile().then((fc) => { if (live) setLand(landRings(fc)); }, () => {});
    return () => { live = false; };
  }, []);
  const eras = useMemo(() => (land ? eraExtents(eraRegions(p.items, [], p.relations, new Date().getFullYear()), p.items, p.relations, p.territories, land, p.regions) : undefined), [land, p.items, p.relations, p.territories, p.regions]);
  // Threads over time: the open entry's, else the picked polity's or world event's.
  const threadDoc = useMemo(() => {
    let members: Map<string, string[]> | undefined;
    return {
      items: p.items, relations: p.relations, territories: p.territories, lanesOf: entryLanes(p.items, []),
      members: (tid: string) => (members ??= polityMembers({ items: p.items, territories: p.territories, relations: p.relations })).get(tid) ?? [],
    };
  }, [p.items, p.relations, p.territories]);
  const threadFocus = p.selectedId ?? p.focus?.pick;
  const threads = useMemo(() => (following ? { focus: threadFocus, all: !!p.allThreads, doc: threadDoc } : undefined), [following, threadFocus, p.allThreads, threadDoc]);
  const picked = p.focus?.pick?.startsWith('pol:') ? p.territories.find((t) => `pol:${t.id}` === p.focus!.pick) : undefined;
  const byHow = (how: ContactHow) => [...(follow?.marks ?? [])].filter(([, m]) => m.how === how).map(([id]) => p.territories.find((t) => t.id === id)?.title).filter(Boolean);
  const regionTerritory = p.region && p.territories.find((t) => t.id === p.region!.territoryId);
  const toggleCause = (c: FlowCause) => p.onFlowOptions({ ...p.flowOptions, hiddenCauses: hiddenCauses.includes(c) ? hiddenCauses.filter((x) => x !== c) : [...hiddenCauses, c] });

  return (
    <section className="map-pane" aria-label="Map">
      <Suspense fallback={<div className="map-host map-loading" role="status">Loading the map…</div>}>
        <MapView
          year={p.year}
          morphYears={morphYears}
          items={p.items}
          territories={p.territories}
          categories={p.categories}
          relations={p.relations}
          flows={shownFlows}
          draftItems={p.draftItems}
          dataSeries={dataSeries}
          options={p.options}
          fadeYears={p.fadeYears}
          selectedId={p.selectedId}
          onOpenItem={p.onOpenItem}
          onOpenTerritory={(id) => {
            const region = following ? p.territories.find((t) => t.id === id)?.region : undefined;
            if (region) p.onRegion!({ name: region, territoryId: id });
            else p.onOpenTerritory(id);
          }}
          follow={follow}
          eras={eras}
          threads={threads}
          onOpenFlow={p.onOpenFlow}
          onBackdropStatus={setBackdrop}
          camera={p.camera}
          onCamera={p.onCamera}
          fitTo={p.fitTo}
          draft={p.drawing ? draft : undefined}
          shape={shape ? { geometry: shape.g, picked: shape.picked } : undefined}
          onShapeEdit={shape ? onShapeEdit : undefined}
          onDrawPoint={p.drawing ? (pt, nearFirst) => setDraft((d) => (nearFirst ? closePart(d) : addPoint(d, pt))) : p.picking ? (pt) => p.picking!.onDone(pt) : undefined}
        />
      </Suspense>

      {p.picking ? (
        <div className="map-draw" role="toolbar" aria-label="Picking a place" data-testid="pick-toolbar">
          <span className="grow">Click on the map to place this end of the route.</span>
          <button className="btn small quiet" onClick={p.picking.onCancel}>Cancel</button>
        </div>
      ) : p.reshaping && shape ? (
        <div className="map-draw" role="toolbar" aria-label="Changing a border" data-testid="reshape-toolbar">
          <span className="grow">{shape.picked ? 'Drag the point to move it, or delete it.' : 'Drag a point to move it, or a dot between two points to add one. Click a point to pick it.'}</span>
          <button className="btn small" disabled={!shape.undo.length} onClick={undoShape}>Undo</button>
          <button className="btn small" disabled={!shape.picked || !canDelete(shape.g, shape.picked)} onClick={deletePoint} title={shape.picked && !canDelete(shape.g, shape.picked) ? 'A border keeps at least three points' : undefined}>Delete point</button>
          <button className="btn small primary" onClick={() => p.reshaping!.onDone(shape.g)}>Done</button>
          <button className="btn small quiet" onClick={p.reshaping.onCancel}>Cancel</button>
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
        {p.region && (
          <div className="notice map-focus" role="status" data-testid="map-region">
            <span className="grow">Showing {p.region.name} on the timeline</span>
            {regionTerritory && <button type="button" className="btn small quiet" onClick={() => p.onOpenTerritory(regionTerritory.id)}>Open {regionTerritory.title}</button>}
            <button type="button" className="btn small quiet" aria-label={`Stop showing ${p.region.name}`} onClick={() => p.onRegion!(undefined)}>×</button>
          </div>
        )}
        {picked && follow && (
          <div className="notice subtle map-follow" role="status" data-testid="map-follow">
            {p.focus?.open && p.focus.lane === 'war' ? (
              byHow('war').length ? `${picked.title} fought ${listOf(byHow('war') as string[])} in these years.` : `${picked.title} fought no one here in these years.`
            ) : (() => {
              const parts = (['war', 'allied', 'trade', 'peace'] as const).flatMap((h) => (byHow(h).length ? [`${DEALT[h]} ${listOf(byHow(h) as string[])}`] : []));
              return parts.length ? `${picked.title} in ${formatYear(Math.floor(p.year))}: ${parts.join('; ')}.` : `${picked.title} in ${formatYear(Math.floor(p.year))}: no dealings with other polities recorded.`;
            })()}
          </div>
        )}
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

const DEALT: Record<ContactHow, string> = { war: 'at war with', allied: 'allied with', trade: 'trading with', peace: 'at peace with' };

/** "Sparta, Corinth and Thebes" */
function listOf(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

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
