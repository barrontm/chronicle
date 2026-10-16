import type { MultiPolygon, Polygon } from 'geojson';

/**
 * Core data model. See docs/data-model.md for the reasoning behind each shape.
 *
 * Years are stored in ASTRONOMICAL numbering: 1 CE = 1, 1 BCE = 0, 2 BCE = -1,
 * 431 BCE = -430. Only src/model/dates.ts converts to and from what people type
 * and read ("431 BCE"). Never do that arithmetic anywhere else.
 */

export interface HistDate {
  /** Astronomical year (see note above). */
  y: number;
  /** Month 1–12, if known. */
  m?: number;
  /** Day 1–31, if known (requires m). */
  d?: number;
  /** True for "c. 1440"-style approximate dates. */
  approx?: boolean;
}

/**
 * The visual "kind" of a timeline item. Topics (war, science, …) are NOT kinds;
 * they are categories. Adding a topic should never require a new kind.
 *  - event:  a single moment (a treaty, a discovery). Point on the timeline.
 *  - span:   something with duration (a war, a reign, a movement). Bar.
 *  - person: a lifespan (birth → death). Rendered as a slim bar with a portrait.
 */
export type ItemKind = 'event' | 'span' | 'person';

export interface Category {
  id: string;
  label: string;
  /** A CSS color. Defaults come from the pigment palette in src/ui/theme.ts. */
  color: string;
}

/** A picture attached to an item: artifact, monument, portrait, artwork… */
export interface MediaRef {
  id: string;
  /** Where the bytes live. 'local' = uploaded file stored in IndexedDB under localId. */
  source: 'url' | 'commons' | 'local';
  /** Display URL for 'url' and 'commons' sources. */
  url?: string;
  /** Smaller URL for thumbnails, if the source provides one. */
  thumbUrl?: string;
  /** Key into the media store for 'local' sources. */
  localId?: string;
  caption?: string;
  /** Author / photographer / artist, plain text. */
  credit?: string;
  /** License short name, e.g. "CC BY-SA 4.0" or "Public domain". */
  license?: string;
  /** Page describing the image (e.g. its Wikimedia Commons file page). */
  sourceUrl?: string;
}

/** Where something happened, or where a person was born or died. Drawn on the map. */
export interface Place {
  name?: string;
  /** Degrees, WGS84. */
  lat: number;
  lon: number;
  role?: 'site' | 'born' | 'died';
}

/**
 * Text quoted from a reference work (e.g. a Wikipedia intro). Kept apart from
 * Bob's own notes and shown as a quotation with its source.
 */
export interface Excerpt {
  text: string;
  sourceId: string;
}

export interface TimelineItem {
  id: string;
  kind: ItemKind;
  title: string;
  start: HistDate;
  /** Required for span and person (unless the person is living); absent for event. */
  end?: HistDate;
  categoryId: string;
  /** Short summary shown on the card. Longer thinking belongs in Notes. */
  description?: string;
  media?: MediaRef[];
  citations?: Citation[];
  tags?: string[];
  places?: Place[];
  excerpt?: Excerpt;
  /** Wikidata id (e.g. "Q913") when the entry came from Wikipedia. Used to spot duplicates. */
  wikidataId?: string;
  /** Epoch ms of the last edit. Drives per-item merge when syncing devices. */
  updatedAt: number;
}

// ---------- Learning layer: notes, sources, connections ----------

/** A reference to a Source, optionally pinned to pages or a timestamp. */
export interface Citation {
  sourceId: string;
  /** "pp. 112–118", "ch. 4", "00:14:30" — free text. */
  locator?: string;
}

/**
 * Your own write-up. A note can be about several things at once
 * (e.g. "Aristotle vs. Plato on forms" links two people and an event).
 */
export interface Note {
  id: string;
  title: string;
  /** Plain text for now; Markdown rendering is on the roadmap. */
  body: string;
  /** Ids of items, series or territories this note is about. */
  linkedIds: string[];
  citations?: Citation[];
  updatedAt: number;
}

export type SourceKind = 'book' | 'article' | 'chapter' | 'lecture' | 'web' | 'video' | 'other';

/** A bibliography entry. Cited from items and notes. */
export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  /** As you'd write them: "Mary Beard" or "Durant, Will; Durant, Ariel". */
  authors?: string;
  /** Text, so "1926", "2nd ed. 2015" or "c. 350 BCE" all work. */
  year?: string;
  publisher?: string;
  url?: string;
  /** Your own remarks on the source: reliability, what it's good for. */
  remarks?: string;
  /** For web sources: the date you read it, as YYYY-MM-DD. */
  accessed?: string;
  updatedAt: number;
}

export type RelationType = 'influenced' | 'caused' | 'part-of' | 'responded-to' | 'related';

/** A directed connection between two items: from → to. */
export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  type: RelationType;
  note?: string;
  updatedAt: number;
}

export interface SeriesPoint {
  /** Astronomical year, may be fractional. */
  x: number;
  v: number;
}

/**
 * A quantity measured over time: population, literacy, GDP, transistor counts…
 * Rendered as a trend strip aligned to the timeline's time axis.
 */
export interface Series {
  id: string;
  title: string;
  unit: string;
  categoryId: string;
  scale: 'linear' | 'log';
  /** The headline curve drawn as a trend strip (e.g. World). May be empty if only regions are known. */
  points: SeriesPoint[];
  /**
   * Values per place, for the map. Keys are ISO 3166-1 alpha-3 country codes
   * ("FRA") or territory ids ("t_…"). Countries color the map; territories get
   * a proportional circle.
   */
  regions?: Record<string, SeriesPoint[]>;
  source?: { name: string; url?: string };
  note?: string;
  updatedAt: number;
}

/**
 * A polity's extent over time, as a sequence of map snapshots. A snapshot
 * applies from `from` up to (not including) `to`; no `to` means "and after".
 */
export interface TerritorySnapshot {
  from: HistDate;
  to?: HistDate;
  /** GeoJSON [lon, lat] geometry, simplified on import. */
  geometry?: Polygon | MultiPolygon;
  areaKm2?: number;
}

export interface Territory {
  id: string;
  title: string;
  categoryId: string;
  snapshots: TerritorySnapshot[];
  /** The timeline entry for this polity (usually a period), if any. */
  itemId?: string;
  wikidataId?: string;
  source?: { name: string; url?: string };
  updatedAt: number;
}

/**
 * One end of a migration route: a present-day country (ISO 3166-1 alpha-3),
 * one of your territories (drawn at its label point in the year shown), or a
 * named point for places that are neither (a Greek colony, a port).
 */
export type FlowEnd =
  | { country: string }
  | { territoryId: string }
  | { name: string; lon: number; lat: number };

export type FlowCause = 'conflict' | 'economic' | 'disaster' | 'forced' | 'settlement' | 'family' | 'unknown';

/**
 * - moved:  people moving per year along the route (a flow; drawn with moving dashes)
 * - living: people from `from` living in `to` that year (a stock; drawn as a still arrow)
 */
export type FlowMeasure = 'moved' | 'living';

export interface FlowRoute {
  from: FlowEnd;
  to: FlowEnd;
  /** x = astronomical year, v = people (per year for 'moved'). Interpolated between points; nothing outside them. */
  points: SeriesPoint[];
}

/** People moving between places over time: the Irish famine emigration, Greek colonization, the Great Migration. */
export interface Flow {
  id: string;
  title: string;
  categoryId: string;
  cause: FlowCause;
  measure: FlowMeasure;
  /** The timeline entry this migration belongs to, if any. */
  itemId?: string;
  routes: FlowRoute[];
  source?: { name: string; url?: string };
  note?: string;
  updatedAt: number;
}

export const SCHEMA_VERSION = 4;

export interface TimelineDoc {
  schemaVersion: number;
  id: string;
  title: string;
  categories: Category[];
  items: TimelineItem[];
  series: Series[];
  territories: Territory[];
  flows: Flow[];
  notes: Note[];
  sources: Source[];
  relations: Relation[];
  /** id → epoch ms when deleted. Lets a merge know a missing item was deleted, not new. */
  deleted: Record<string, number>;
  updatedAt: number;
}
