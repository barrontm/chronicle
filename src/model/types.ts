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
  points: SeriesPoint[];
  source?: { name: string; url?: string };
  note?: string;
  updatedAt: number;
}

/**
 * A polity's extent over time, as a sequence of map snapshots.
 * Stored now so the schema is stable; rendering arrives in the "Maps" milestone.
 */
export interface TerritorySnapshot {
  from: HistDate;
  to?: HistDate;
  /** GeoJSON geometry (Polygon/MultiPolygon). Typed loosely until the map renderer lands. */
  geometry?: unknown;
  areaKm2?: number;
}

export interface Territory {
  id: string;
  title: string;
  categoryId: string;
  snapshots: TerritorySnapshot[];
  source?: { name: string; url?: string };
  updatedAt: number;
}

export const SCHEMA_VERSION = 1;

export interface TimelineDoc {
  schemaVersion: number;
  id: string;
  title: string;
  categories: Category[];
  items: TimelineItem[];
  series: Series[];
  territories: Territory[];
  notes: Note[];
  sources: Source[];
  relations: Relation[];
  /** id → epoch ms when deleted. Lets a merge know a missing item was deleted, not new. */
  deleted: Record<string, number>;
  updatedAt: number;
}
