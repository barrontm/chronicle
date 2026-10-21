import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, LineString } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import { basemapFor, BASEMAPS_CREDIT, fetchBasemap } from '../data/basemaps';
import { CLIOPATRIA_CREDIT, isCliopatria } from '../data/cliopatria';
import { loadCountries } from '../data/countries';
import { formatYear } from '../model/dates';
import type { Category, Flow, Relation, Series, Territory, TimelineItem } from '../model/types';
import { draftFeatures, type Draft } from './drawing';
import { activeRoutes, arcsBetween, causeOf, choroplethAt, CONTACT_COLOR, draftPins, type FollowAt, flowDashes, flowFeatures, flowScale, mixColor, pinsAt, territoriesAt, territoryCircles, type FlowLineProps, type FlowPlaces } from './mapData';
import { formatValue } from './util';

/**
 * Adapter around MapLibre GL. This is the ONLY file that imports maplibre-gl,
 * the same rule as TimelineView and the timeline renderer.
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
  /** Migrations to draw (already filtered by category and cause). */
  flows: Flow[];
  /** AI-drafted entries waiting for review, drawn as dashed pins whatever the year. */
  draftItems?: TimelineItem[];
  /** The trend chosen as the map's data layer, if any. */
  dataSeries?: Series;
  options: MapOptions;
  fadeYears: number;
  selectedId?: string;
  onOpenItem: (id: string) => void;
  onOpenTerritory: (id: string) => void;
  onOpenFlow: (id: string) => void;
  onBackdropStatus: (s: BackdropStatus) => void;
  /** Where to open the map, and a callback when Bob pans or zooms. */
  camera?: MapCamera;
  onCamera?: (c: MapCamera) => void;
  /** Fit the map to a box (a search result's place or territory); a new `at` fits again. */
  fitTo?: MapFit;
  /** While drawing a border: the shape so far, and where a click lands (and whether it's on the first point). */
  draft?: Draft;
  onDrawPoint?: (p: [number, number], nearFirst: boolean) => void;
  /** Following the overview (`followAt`): shapes over the territories, pins, marked labels, and where to fit. */
  follow?: FollowAt;
}

export interface MapFit { bounds: [number, number, number, number]; at: number }

/** A place is centred close up, a territory framed whole. */
function fitMap(map: maplibregl.Map, [w, s, e, n]: MapFit['bounds']) {
  if (w === e && s === n) map.easeTo({ center: [w, s], zoom: Math.max(map.getZoom(), 6), duration: 600 });
  else map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 7, duration: 600 });
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
      flows: { type: 'geojson', data: EMPTY },
      'flow-dashes': { type: 'geojson', data: EMPTY },
      'flow-heads': { type: 'geojson', data: EMPTY },
      pins: { type: 'geojson', data: EMPTY },
      follow: { type: 'geojson', data: EMPTY },
      'follow-pins': { type: 'geojson', data: EMPTY },
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
      // Following the overview: the picked polity in ink, the polities it dealt with in their contact's colour, its reach and earlier borders dashed.
      { id: 'follow-fill', type: 'fill', source: 'follow', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fill'] } },
      { id: 'follow-line', type: 'line', source: 'follow', filter: ['!', ['get', 'dashed']], paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] } },
      { id: 'follow-dash', type: 'line', source: 'follow', filter: ['get', 'dashed'], paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [3, 2] } },
      {
        id: 'circles', type: 'circle', source: 'circles',
        paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.35, 'circle-radius': ['get', 'radius'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5 },
      },
      {
        id: 'flows', type: 'line', source: 'flows', layout: { 'line-cap': 'round' },
        // Moving routes are a faint track for their dashes; still arrows (people living abroad) are solid.
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['case', ['get', 'moving'], 0.3, 0.75] },
      },
      { id: 'flow-dashes', type: 'line', source: 'flow-dashes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.95 } },
      {
        id: 'flow-heads', type: 'symbol', source: 'flow-heads',
        layout: {
          'icon-image': 'flow-arrow', 'icon-size': ['get', 'size'], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map',
          'icon-anchor': 'top', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: { 'icon-color': ['get', 'color'] },
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
      {
        id: 'follow-pins', type: 'circle', source: 'follow-pins',
        paint: { 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacity'], 'circle-radius': 6, 'circle-stroke-color': c.panel, 'circle-stroke-width': 1.5, 'circle-stroke-opacity': ['get', 'opacity'] },
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
  map.setPaintProperty('follow-pins', 'circle-stroke-color', c.panel);
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
function syncLabels(map: maplibregl.Map, store: Map<string, maplibregl.Marker>, labels: Array<{ id: string; lon: number; lat: number; text: string; className: string; opacity?: number; contact?: string; color?: string }>) {
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
    // How a polity dealt with the one picked on the overview ("at war"), coloured as its shape.
    if (l.contact) el.dataset.contact = l.contact;
    else delete el.dataset.contact;
    if (l.color) el.style.setProperty('--c', l.color);
    else el.style.removeProperty('--c');
    m.setLngLat([l.lon, l.lat]);
  }
  for (const [id, m] of store) if (!seen.has(id)) { m.remove(); store.delete(id); }
}

/** An arrowhead pointing up with its tip at the top edge, as a signed distance field so it can take any color. */
function arrowImage(size = 40): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  const tri = [[size / 2, 2], [size - 4, size - 4], [4, size - 4]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let inside = true;
    let d = Infinity;
    for (let i = 0; i < 3; i++) {
      const [ax, ay] = tri[i];
      const [bx, by] = tri[(i + 1) % 3];
      const cross = (bx - ax) * (y + 0.5 - ay) - (by - ay) * (x + 0.5 - ax);
      if (cross < 0) inside = false;
      const len = Math.hypot(bx - ax, by - ay);
      const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * (bx - ax) + (y + 0.5 - ay) * (by - ay)) / (len * len)));
      d = Math.min(d, Math.hypot(x + 0.5 - (ax + t * (bx - ax)), y + 0.5 - (ay + t * (by - ay))));
    }
    const signed = inside ? -d : d;
    data[(y * size + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(255 * (0.75 - signed / 8))));
  }
  return { width: size, height: size, data };
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MapView(props: Props) {
  const { year, items, territories, categories, relations, flows, dataSeries, options, fadeYears, selectedId, onBackdropStatus } = props;
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const lastFit = useRef<MapFit['bounds'] | null>(null);
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

    map.on('load', () => {
      map.addImage('flow-arrow', arrowImage(), { sdf: true, pixelRatio: 2 });
      setReady(true);
    });
    // While it pans or zooms (tests wait for it to settle before clicking a place).
    map.on('movestart', () => { if (host.current) host.current.dataset.moving = ''; });
    map.on('moveend', () => {
      if (host.current) delete host.current.dataset.moving;
      const c = map.getCenter();
      cb.current.onCamera?.({ center: [Math.round(c.lng * 1e4) / 1e4, Math.round(c.lat * 1e4) / 1e4], zoom: Math.round(map.getZoom() * 100) / 100 });
    });
    const pointer = (layer: string) => {
      map.on('mouseenter', layer, () => { if (!cb.current.onDrawPoint) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { if (!cb.current.onDrawPoint) map.getCanvas().style.cursor = ''; });
    };
    pointer('pins');
    pointer('territories-fill');
    pointer('flows');
    pointer('follow-pins');
    map.on('click', (e) => {
      const draw = cb.current.onDrawPoint;
      if (draw) {
        // Clicking within 10 px of the first point closes the outline.
        const first = cb.current.draft?.current[0];
        const near = !!first && map.project(first as [number, number]).dist(e.point) <= 10;
        return draw([e.lngLat.lng, e.lngLat.lat], near);
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: ['follow-pins', 'pins', 'flows', 'territories-fill'] });
      const pin = hit.find((f) => f.layer.id === 'follow-pins' || f.layer.id === 'pins');
      if (pin) return cb.current.onOpenItem(String(pin.properties.id));
      const flow = hit.find((f) => f.layer.id === 'flows');
      if (flow) return cb.current.onOpenFlow(String(flow.properties.id).split('#')[0]);
      const terr = hit.find((f) => f.layer.id === 'territories-fill');
      if (terr) cb.current.onOpenTerritory(String(terr.properties.id));
    });
    // Hover: a pin's title, a country's value on the data layer, or a polity name from the backdrop.
    map.on('mousemove', (e: MapLayerMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: ['follow-pins', 'pins', 'flows', 'circles', 'territories-fill', 'land', 'backdrop-fill'] });
      let text: string | undefined;
      const pin = hits.find((f) => f.layer.id === 'follow-pins' || f.layer.id === 'pins');
      const flow = hits.find((f) => f.layer.id === 'flows');
      const circle = hits.find((f) => f.layer.id === 'circles');
      const country = hits.find((f) => f.layer.id === 'land');
      const s = hover.current.series;
      if (pin) text = String(pin.properties.title);
      else if (flow) text = String(flow.properties.label);
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

    // The map's box changes as the drawer opens: a search result stays fitted until Bob moves the map himself.
    map.on('movestart', (e) => { if (e.originalEvent) lastFit.current = null; });
    const ro = new ResizeObserver(() => {
      map.resize();
      if (lastFit.current) fitMap(map, lastFit.current);
    });
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

  // Seshat's borders are credited in the map's credits while any territory uses them.
  const seshat = territories.some((t) => isCliopatria(t.source));
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const has = !!map.getSource('seshat-credit');
    // MapLibre credits only sources a layer uses, so it gets an empty, invisible one.
    if (seshat && !has) {
      map.addSource('seshat-credit', { type: 'geojson', data: EMPTY, attribution: `<a href="${CLIOPATRIA_CREDIT.url}" target="_blank" rel="noreferrer">Cliopatria (Seshat), CC BY 4.0</a>` });
      map.addLayer({ id: 'seshat-credit', type: 'fill', source: 'seshat-credit', paint: { 'fill-opacity': 0 } });
    } else if (!seshat && has) {
      map.removeLayer('seshat-credit');
      map.removeSource('seshat-credit');
    }
  }, [seshat, ready]);

  // Territories (only redrawn when a different snapshot becomes current).
  const terr = useMemo(() => territoriesAt(territories, year, colorOf), [territories, year, colorOf]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (terr.key !== lastTerritoryKey.current) {
      (map.getSource('territories') as GeoJSONSource).setData(terr.shapes);
      lastTerritoryKey.current = terr.key;
    }
    const marks = props.follow?.marks;
    syncLabels(map, territoryLabels.current, terr.labels.map((l) => {
      const m = marks?.get(l.id);
      const color = m && m.how !== 'picked' ? colors.resolve(m.how === 'gold' ? 'var(--gold-text)' : CONTACT_COLOR[m.how]) : undefined;
      return { id: l.id, lon: l.lon, lat: l.lat, text: m?.text ? `${l.title} · ${m.text}` : l.title, className: 'territory', contact: m?.how, color };
    }));
  }, [terr, ready, props.follow?.marks, colors]);

  // Following the overview: its shapes and pins, drawn over the territories.
  const follow = props.follow;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const shapes = follow?.shapes ?? (EMPTY as FollowAt['shapes']);
    (map.getSource('follow') as GeoJSONSource).setData({ ...shapes, features: shapes.features.map((f) => ({ ...f, properties: { ...f.properties, color: colors.resolve(f.properties.color) } })) });
    const pins = follow?.pins ?? (EMPTY as FollowAt['pins']);
    (map.getSource('follow-pins') as GeoJSONSource).setData({ ...pins, features: pins.features.map((f) => ({ ...f, properties: { ...f.properties, color: colors.resolve(f.properties.color) } })) });
    host.current?.setAttribute('data-follow-pins', String(pins.features.length));
  }, [follow, colors, ready]);
  // The map fits what's picked when the pick changes, and a region when Bob clicks one.
  const pickFitKey = follow?.pickFit?.key;
  useEffect(() => {
    const map = mapRef.current;
    const b = follow?.pickFit?.bounds;
    if (!map || !ready || !b) return;
    lastFit.current = b;
    fitMap(map, b);
  }, [pickFitKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const regionFitKey = follow?.regionFit?.key;
  useEffect(() => {
    const map = mapRef.current;
    const b = follow?.regionFit?.bounds;
    if (!map || !ready || !b) return;
    lastFit.current = b;
    fitMap(map, b);
  }, [regionFitKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Migration: curved routes sized by the rate, arrowheads, and dashes that move while people are moving.
  const [countries, setCountries] = useState<FlowPlaces['countries']>(new Map());
  useEffect(() => {
    if (!flows.length || countries.size) return;
    let live = true;
    // Without the list, routes to countries wait; named points and territories still draw.
    loadCountries().then((list) => { if (live) setCountries(new Map(list.map((c) => [c.code, c]))); }, () => {});
    return () => { live = false; };
  }, [flows.length, countries.size]);
  const scale = useMemo(() => flowScale(flows), [flows]);
  const flowLines = useRef<FeatureCollection<LineString, FlowLineProps>>({ type: 'FeatureCollection', features: [] });
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const active = activeRoutes(flows, year, () => true);
    const { lines, heads } = flowFeatures(active, { countries, territories, year }, scale, (c) => colors.resolve(causeOf(c).color));
    flowLines.current = lines;
    (map.getSource('flows') as GeoJSONSource).setData(lines);
    (map.getSource('flow-heads') as GeoJSONSource).setData(heads);
    // For tests and assistive checks: how many routes are drawn right now.
    host.current?.setAttribute('data-flow-count', String(lines.features.length));
    const anyMoving = lines.features.some((f) => f.properties.moving);
    setMoving(anyMoving);
    // While the animation runs it redraws the dashes itself; otherwise draw them still.
    if (!anyMoving || reducedMotion()) (map.getSource('flow-dashes') as GeoJSONSource).setData(flowDashes(lines, 0));
  }, [flows, year, countries, territories, scale, colors, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !moving || reducedMotion()) return;
    const src = map.getSource('flow-dashes') as GeoJSONSource;
    const t0 = performance.now();
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      // About 30 frames a second is smooth enough and keeps the map responsive.
      if (now - last > 33) { last = now; src.setData(flowDashes(flowLines.current, (now - t0) / 1000)); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [moving, ready]);

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

  // AI drafts: dashed rings (HTML, since circle strokes can't dash) with their names, framed whenever the set changes.
  const draftMarkers = useRef(new Map<string, maplibregl.Marker>());
  const drafts = useMemo(() => draftPins(props.draftItems ?? [], colorOf), [props.draftItems, colorOf]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const store = draftMarkers.current;
    const seen = new Set<string>();
    for (const p of drafts.pins) {
      seen.add(p.id);
      let m = store.get(p.id);
      if (!m) {
        const el = document.createElement('div');
        el.classList.add('map-label', 'draft-pin');
        el.title = `Draft: ${p.title}`;
        const ring = document.createElement('span');
        ring.className = 'ring';
        const text = document.createElement('span');
        text.className = 'name';
        el.append(ring, text);
        m = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, -7] }).setLngLat([p.lon, p.lat]).addTo(map);
        store.set(p.id, m);
      }
      const el = m.getElement();
      el.style.setProperty('--c', p.color);
      el.querySelector('.name')!.textContent = p.title;
      m.setLngLat([p.lon, p.lat]);
    }
    for (const [id, m] of store) if (!seen.has(id)) { m.remove(); store.delete(id); }
  }, [drafts, ready]);
  const draftKey = drafts.pins.map((p) => p.id).join();
  useEffect(() => {
    const map = mapRef.current;
    const b = drafts.bounds;
    if (!map || !ready || !b) return;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 7, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, ready]);

  // Bring a selected entry into view if it's off the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const place = items.find((i) => i.id === selectedId)?.places?.[0];
    if (place && !map.getBounds().contains([place.lon, place.lat])) map.easeTo({ center: [place.lon, place.lat], duration: 600 });
  }, [selectedId, items, ready]);

  // Fit to what Bob picked in the search.
  const fitTo = props.fitTo;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fitTo) return;
    lastFit.current = fitTo.bounds;
    fitMap(map, fitTo.bounds);
  }, [fitTo?.at, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="map-host" data-testid="map" data-ready={ready || undefined} />;
}
