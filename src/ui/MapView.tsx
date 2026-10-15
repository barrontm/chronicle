import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import { basemapFor, BASEMAPS_CREDIT, fetchBasemap } from '../data/basemaps';
import { formatYear } from '../model/dates';
import type { Category, Relation, Series, Territory, TimelineItem } from '../model/types';
import { draftFeatures, type Draft } from './drawing';
import { arcsBetween, choroplethAt, mixColor, pinsAt, territoriesAt, territoryCircles } from './mapData';
import { formatValue } from './util';

/**
 * Adapter around MapLibre GL. This is the ONLY file that imports maplibre-gl,
 * the same rule as TimelineView and vis-timeline.
 *
 * The basemap is bundled (Natural Earth countries, lakes and rivers in
 * public/geo), so there are no tiles to fetch and the map works offline.
 * Text labels are HTML markers rather than map symbols, because symbol text
 * needs glyph files from a server.
 */
maplibregl.setWorkerUrl(workerUrl);

export interface MapOptions {
  /** Faint outlines of every polity from the nearest historical map. Fetched, never saved. */
  backdrop: boolean;
  /** Keep entries on the map after they're over, so you can watch something spread. */
  keepPast: boolean;
  /** Draw connections between entries that are both on the map. */
  connections: boolean;
}

/** Where the map is looking; remembered per device. */
export interface MapCamera { center: [number, number]; zoom: number }

export type BackdropStatus = { state: 'off' } | { state: 'loading'; year: number } | { state: 'ready'; year: number } | { state: 'error'; message: string };

interface Props {
  year: number;
  items: TimelineItem[];
  territories: Territory[];
  categories: Category[];
  relations: Relation[];
  /** The trend chosen as the map's data layer, if any. */
  dataSeries?: Series;
  options: MapOptions;
  fadeYears: number;
  selectedId?: string;
  onOpenItem: (id: string) => void;
  onOpenTerritory: (id: string) => void;
  onBackdropStatus: (s: BackdropStatus) => void;
  /** Where to open the map, and a callback when Bob pans or zooms. */
  camera?: MapCamera;
  onCamera?: (c: MapCamera) => void;
  /** While drawing a border: the shape so far, and where a click lands (and whether it's on the first point). */
  draft?: Draft;
  onDrawPoint?: (p: [number, number], nearFirst: boolean) => void;
}

const BASE = import.meta.env.BASE_URL;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

interface Colors {
  water: string; land: string; border: string; river: string; ink: string; panel: string; backdrop: string;
  resolve: (c: string) => string;
}

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const resolve = (c: string) => {
    const m = c.match(/^var\((--[\w-]+)\)$/);
    return m ? v(m[1]) || '#888' : c;
  };
  return {
    water: v('--map-water'), land: v('--map-land'), border: v('--map-border'), river: v('--map-river'),
    ink: v('--ink'), panel: v('--panel'), backdrop: v('--map-backdrop'), resolve,
  };
}

function graticule(step = 15): FeatureCollection {
  const lines: number[][][] = [];
  for (let lon = -180; lon <= 180; lon += step) lines.push(Array.from({ length: 33 }, (_, i) => [lon, -80 + i * 5]));
  for (let lat = -75; lat <= 75; lat += step) lines.push(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }] };
}

function buildStyle(c: Colors): StyleSpecification {
  return {
    version: 8,
    sources: {
      countries: { type: 'geojson', data: `${BASE}geo/countries.json`, promoteId: 'iso3', attribution: 'Natural Earth' },
      lakes: { type: 'geojson', data: `${BASE}geo/lakes.json` },
      rivers: { type: 'geojson', data: `${BASE}geo/rivers.json` },
      graticule: { type: 'geojson', data: graticule() },
      backdrop: { type: 'geojson', data: EMPTY, attribution: `<a href="${BASEMAPS_CREDIT.url}" target="_blank" rel="noreferrer">historical-basemaps</a>` },
      territories: { type: 'geojson', data: EMPTY },
      circles: { type: 'geojson', data: EMPTY },
      arcs: { type: 'geojson', data: EMPTY },
      pins: { type: 'geojson', data: EMPTY },
      draft: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'water', type: 'background', paint: { 'background-color': c.water } },
      { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': c.border, 'line-opacity': 0.35, 'line-width': 0.5 } },
      {
        id: 'land', type: 'fill', source: 'countries',
        paint: {
          'fill-color': ['case', ['!=', ['feature-state', 'shade'], null], ['to-color', ['feature-state', 'color']], c.land],
        },
      },
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': c.water } },
      { id: 'rivers', type: 'line', source: 'rivers', paint: { 'line-color': c.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.3, 6, 1.4] } },
      { id: 'borders', type: 'line', source: 'countries', layout: { visibility: 'none' }, paint: { 'line-color': c.border, 'line-width': 0.6 } },
      { id: 'backdrop-fill', type: 'fill', source: 'backdrop', paint: { 'fill-color': c.backdrop, 'fill-opacity': 0.06 } },
      { id: 'backdrop-line', type: 'line', source: 'backdrop', paint: { 'line-color': c.backdrop, 'line-opacity': 0.55, 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      { id: 'territories-fill', type: 'fill', source: 'territories', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.32 } },
      { id: 'territories-line', type: 'line', source: 'territories', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6 } },
      {
        id: 'circles', type: 'circle', source: 'circles',
        paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.35, 'circle-radius': ['get', 'radius'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5 },
      },
      { id: 'arcs', type: 'line', source: 'arcs', paint: { 'line-color': ['get', 'color'], 'line-opacity': ['*', 0.7, ['get', 'opacity']], 'line-width': 1.5, 'line-dasharray': [2, 1.5] } },
      {
        id: 'pins', type: 'circle', source: 'pins',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-radius': ['case', ['get', 'selected'], 8, ['==', ['get', 'kind'], 'person'], 5, 6],
          'circle-stroke-color': ['case', ['get', 'selected'], c.ink, c.panel],
          'circle-stroke-width': ['case', ['get', 'selected'], 2.5, 1.5],
          'circle-stroke-opacity': ['get', 'opacity'],
        },
      },
      { id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c.ink, 'fill-opacity': 0.15 } },
      { id: 'draft-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': c.ink, 'line-width': 2 } },
      {
        id: 'draft-points', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': c.panel, 'circle-radius': ['case', ['get', 'first'], 6, 4], 'circle-stroke-color': c.ink, 'circle-stroke-width': 2 },
      },
    ],
  };
}

/** Re-apply theme colors to an existing style (system light/dark switch). */
function applyColors(map: maplibregl.Map, c: Colors) {
  map.setPaintProperty('water', 'background-color', c.water);
  map.setPaintProperty('graticule', 'line-color', c.border);
  map.setPaintProperty('land', 'fill-color', ['case', ['!=', ['feature-state', 'shade'], null], ['to-color', ['feature-state', 'color']], c.land]);
  map.setPaintProperty('lakes', 'fill-color', c.water);
  map.setPaintProperty('rivers', 'line-color', c.river);
  map.setPaintProperty('borders', 'line-color', c.border);
  map.setPaintProperty('backdrop-fill', 'fill-color', c.backdrop);
  map.setPaintProperty('backdrop-line', 'line-color', c.backdrop);
  map.setPaintProperty('pins', 'circle-stroke-color', ['case', ['get', 'selected'], c.ink, c.panel]);
  map.setPaintProperty('draft-fill', 'fill-color', c.ink);
  map.setPaintProperty('draft-line', 'line-color', c.ink);
  map.setPaintProperty('draft-points', 'circle-color', c.panel);
  map.setPaintProperty('draft-points', 'circle-stroke-color', c.ink);
}

function useColors(): Colors {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTick((n) => n + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(readColors, [tick]);
}

/** Keep a set of HTML label markers in sync with a list of {id, lon, lat, text}. */
function syncLabels(map: maplibregl.Map, store: Map<string, maplibregl.Marker>, labels: Array<{ id: string; lon: number; lat: number; text: string; className: string; opacity?: number }>) {
  const seen = new Set<string>();
  for (const l of labels) {
    seen.add(l.id);
    let m = store.get(l.id);
    if (!m) {
      const el = document.createElement('div');
      // Add, never replace, classes: MapLibre positions markers with its own classes on this element.
      el.classList.add('map-label', l.className);
      m = new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([l.lon, l.lat]).addTo(map);
      store.set(l.id, m);
    }
    const el = m.getElement();
    if (el.textContent !== l.text) el.textContent = l.text;
    el.style.opacity = String(l.opacity ?? 1);
    m.setLngLat([l.lon, l.lat]);
  }
  for (const [id, m] of store) if (!seen.has(id)) { m.remove(); store.delete(id); }
}

export default function MapView(props: Props) {
  const { year, items, territories, categories, relations, dataSeries, options, fadeYears, selectedId, onBackdropStatus } = props;
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const colors = useColors();
  const territoryLabels = useRef(new Map<string, maplibregl.Marker>());
  const pinLabels = useRef(new Map<string, maplibregl.Marker>());
  const shaded = useRef(new Set<string>());
  const lastTerritoryKey = useRef<string | null>(null);
  const hover = useRef<{ values: Map<string, number>; series?: Series }>({ values: new Map() });
  const cb = useRef(props);
  cb.current = props;

  const colorOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, colors.resolve(c.color)]));
    return (id: string) => m.get(id);
  }, [categories, colors]);

  // Create the map once.
  useEffect(() => {
    if (!host.current) return;
    const map = new maplibregl.Map({
      container: host.current,
      style: buildStyle(readColors()),
      center: cb.current.camera?.center ?? [20, 35],
      zoom: cb.current.camera?.zoom ?? 1.6,
      minZoom: 0.5,
      maxZoom: 10,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'map-popup', offset: 10 });

    map.on('load', () => setReady(true));
    map.on('moveend', () => {
      const c = map.getCenter();
      cb.current.onCamera?.({ center: [Math.round(c.lng * 1e4) / 1e4, Math.round(c.lat * 1e4) / 1e4], zoom: Math.round(map.getZoom() * 100) / 100 });
    });
    const pointer = (layer: string) => {
      map.on('mouseenter', layer, () => { if (!cb.current.onDrawPoint) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { if (!cb.current.onDrawPoint) map.getCanvas().style.cursor = ''; });
    };
    pointer('pins');
    pointer('territories-fill');
    map.on('click', (e) => {
      const draw = cb.current.onDrawPoint;
      if (draw) {
        // Clicking within 10 px of the first point closes the outline.
        const first = cb.current.draft?.current[0];
        const near = !!first && map.project(first as [number, number]).dist(e.point) <= 10;
        return draw([e.lngLat.lng, e.lngLat.lat], near);
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: ['pins', 'territories-fill'] });
      const pin = hit.find((f) => f.layer.id === 'pins');
      if (pin) return cb.current.onOpenItem(String(pin.properties.id));
      const terr = hit.find((f) => f.layer.id === 'territories-fill');
      if (terr) cb.current.onOpenTerritory(String(terr.properties.id));
    });
    // Hover: a pin's title, a country's value on the data layer, or a polity name from the backdrop.
    map.on('mousemove', (e: MapLayerMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: ['pins', 'circles', 'territories-fill', 'land', 'backdrop-fill'] });
      let text: string | undefined;
      const pin = hits.find((f) => f.layer.id === 'pins');
      const circle = hits.find((f) => f.layer.id === 'circles');
      const country = hits.find((f) => f.layer.id === 'land');
      const s = hover.current.series;
      if (pin) text = String(pin.properties.title);
      else if (circle && s) text = `${circle.properties.title}: ${formatValue(Number(circle.properties.value), s.unit)}`;
      else if (country && s && hover.current.values.has(String(country.properties.iso3))) {
        text = `${country.properties.name}: ${formatValue(hover.current.values.get(String(country.properties.iso3))!, s.unit)}`;
      } else {
        const terr = hits.find((f) => f.layer.id === 'territories-fill');
        const back = hits.find((f) => f.layer.id === 'backdrop-fill');
        if (terr) text = String(terr.properties.title);
        else if (back?.properties.NAME) text = String(back.properties.NAME);
      }
      if (text) popup.setLngLat(e.lngLat).setText(text).addTo(map);
      else popup.remove();
    });
    map.on('mouseout', () => popup.remove());

    // The map's box changes when the drawer opens or the split moves.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
      territoryLabels.current.clear();
      pinLabels.current.clear();
      shaded.current.clear();
    };
  }, []);

  // Theme changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) applyColors(map, colors);
  }, [colors, ready]);

  // Territories (only redrawn when a different snapshot becomes current).
  const terr = useMemo(() => territoriesAt(territories, year, colorOf), [territories, year, colorOf]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (terr.key !== lastTerritoryKey.current) {
      (map.getSource('territories') as GeoJSONSource).setData(terr.shapes);
      lastTerritoryKey.current = terr.key;
    }
    syncLabels(map, territoryLabels.current, terr.labels.map((l) => ({ id: l.id, lon: l.lon, lat: l.lat, text: l.title, className: 'territory' })));
  }, [terr, ready]);

  // Entries and connections.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pins = pinsAt(items, year, { fadeYears, keepPast: options.keepPast, colorOf, selectedId });
    (map.getSource('pins') as GeoJSONSource).setData(pins);
    (map.getSource('arcs') as GeoJSONSource).setData(options.connections ? arcsBetween(relations, pins) : EMPTY);
    // Name the pins when there are few enough to read; otherwise hover shows names.
    const labelled = pins.features.length <= 40 ? pins.features : pins.features.filter((f) => f.properties.selected);
    syncLabels(map, pinLabels.current, labelled.map((f, i) => ({
      id: `${f.properties.id}#${i}`, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      text: f.properties.title, className: 'pin', opacity: f.properties.opacity,
    })));
  }, [items, relations, year, fadeYears, options.keepPast, options.connections, colorOf, selectedId, ready]);

  // Data layer: countries shaded by value, territories with sized circles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const code of shaded.current) map.setFeatureState({ source: 'countries', id: code }, { shade: null, color: null });
    shaded.current.clear();
    hover.current = { values: new Map(), series: dataSeries };
    map.setLayoutProperty('borders', 'visibility', dataSeries ? 'visible' : 'none');
    if (!dataSeries) {
      (map.getSource('circles') as GeoJSONSource).setData(EMPTY);
      return;
    }
    const tint = colorOf(dataSeries.categoryId) ?? colors.ink;
    const { shades, values } = choroplethAt(dataSeries, year);
    for (const [code, t] of shades) {
      // A light start so low values still read as "has data", up to the full category color.
      map.setFeatureState({ source: 'countries', id: code }, { shade: t, color: mixColor(mixColor(colors.land, tint, 0.12), tint, t) });
      shaded.current.add(code);
    }
    hover.current.values = values;
    (map.getSource('circles') as GeoJSONSource).setData(territoryCircles(dataSeries, terr, year, tint));
  }, [dataSeries, year, terr, colorOf, colors, ready]);

  // Reference backdrop: the nearest historical map at or before the year.
  const backdropFile = options.backdrop ? basemapFor(year) : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('backdrop') as GeoJSONSource;
    if (!backdropFile) {
      src.setData(EMPTY);
      onBackdropStatus({ state: 'off' });
      return;
    }
    let live = true;
    onBackdropStatus({ state: 'loading', year: backdropFile.y });
    fetchBasemap(backdropFile).then(
      (fc) => { if (live) { src.setData(fc); onBackdropStatus({ state: 'ready', year: backdropFile.y }); } },
      (e: Error) => {
        if (!live) return;
        src.setData(EMPTY);
        onBackdropStatus({
          state: 'error',
          message: navigator.onLine ? e.message : `You’re offline. Reference borders for ${formatYear(backdropFile.y)} haven’t been saved on this device yet; they need a connection the first time.`,
        });
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backdropFile, ready]);

  // Drawing a border: show the draft, aim with a crosshair, and let double-clicks add points instead of zooming.
  const drawing = !!props.onDrawPoint;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('draft') as GeoJSONSource).setData(props.draft ? draftFeatures(props.draft) : EMPTY);
  }, [props.draft, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [drawing, ready]);

  // Bring a selected entry into view if it's off the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const place = items.find((i) => i.id === selectedId)?.places?.[0];
    if (place && !map.getBounds().contains([place.lon, place.lat])) map.easeTo({ center: [place.lon, place.lat], duration: 600 });
  }, [selectedId, items, ready]);

  return <div ref={host} className="map-host" data-testid="map" data-ready={ready || undefined} />;
}
