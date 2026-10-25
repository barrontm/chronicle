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
 * Text quoted from a reference work (e.g. a Wikipedia intro). Schema v2–v5
 * stored one on an entry; v6 migrates it into a `Highlight`.
 */
export interface Excerpt {
  text: string;
  sourceId: string;
}

/** Before v9: the six sides of an era. Still read from older entries and highlights; v9 writes `lanes`. */
export const DIMENSIONS = ['political', 'economic', 'social', 'technological', 'intellectual', 'religious'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/**
 * The six lanes under a polity or world event, in pigment order (v9). An entry or highlight can be
 * in several. Categories stay Bob's topics; lanes are what the overview draws.
 */
export const LANES = ['politics', 'war', 'economy', 'ideas', 'technology', 'nature'] as const;
export type Lane = (typeof LANES)[number];

/** What shows at the top of the overview: "shown" by Bob's choice, or a world event (gold, always shown). */
export const OVERVIEW_MARKS = ['shown', 'world'] as const;
export type OverviewMark = (typeof OVERVIEW_MARKS)[number];

/** What kind of thing an entry is, so the timeline and map can draw it as one (see `subjects.ts`). */
export const SUBJECT_KINDS = ['person', 'polity', 'period', 'war', 'battle', 'event', 'idea', 'technology', 'economy', 'work', 'place', 'migration'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * Where a highlight sits in an article, as a quote with its context (the W3C
 * TextQuoteSelector idea), so it can be found again after the page is edited.
 */
export interface TextAnchor {
  /** The Wikipedia revision it was made on. */
  revisionId?: number;
  /** Heading text of the section it's in ("" for the lead). */
  section?: string;
  exact: string;
  prefix?: string;
  suffix?: string;
  /** Character offset in the article's text: a hint for picking between repeats. */
  pos?: number;
}

/**
 * A passage Bob highlighted (or, before v6, an entry's quoted excerpt). Quoted
 * text, never Bob's own words; records point at the highlights behind them.
 */
export interface Highlight {
  id: string;
  sourceId: string;
  text: string;
  /** Absent for quotes that weren't made in the reader (migrated excerpts). */
  anchor?: TextAnchor;
  /** Before v9; kept so nothing is lost. */
  dimension?: Dimension;
  /** Which lanes the passage is about (v9), in `LANES` order. */
  lanes?: Lane[];
  /** Wikidata id of the article's subject, when known. */
  subjectQid?: string;
  /** Ids of the records this highlight justifies (entries, connections…). */
  usedBy: string[];
  updatedAt: number;
}

/** A theme of a period: a group of Bob's highlights under a short label. */
export interface Theme {
  id: string;
  label: string;
  dimension?: Dimension;
  highlightIds: string[];
  /** Set when an AI-suggested grouping or label was accepted. */
  drafted?: Provenance;
}

/**
 * Where an AI-drafted record came from. Set when Bob accepts a draft; it stays
 * if he edits the record later, so he can always tell drafted data apart.
 */
export interface Provenance {
  /** Model id, e.g. "claude-opus-5-5". */
  model: string;
  /** Feature and prompt version, e.g. "entries@1". */
  prompt: string;
  /** Epoch ms when the draft was made. */
  draftedAt: number;
}

export interface TimelineItem {
  id: string;
  kind: ItemKind;
  title: string;
  /** Missing only on a place whose founding isn't known: it is on the map, not the timeline. */
  start?: HistDate;
  /** Required for span and person (unless the person is living); absent for event. */
  end?: HistDate;
  categoryId: string;
  /** Short summary shown on the card. Longer thinking belongs in Notes. */
  description?: string;
  media?: MediaRef[];
  citations?: Citation[];
  tags?: string[];
  places?: Place[];
  /** Before v9: which of the six dimensions it was mostly about. Kept so nothing is lost; read `lanes`. */
  dimension?: Dimension;
  /** Bob's lanes (v9), in `LANES` order. When absent, `lanesOf` sorts it automatically. */
  lanes?: Lane[];
  /** Shown at the top of the overview, or a world event (v9). */
  overview?: OverviewMark;
  /** What kind of thing it is. Missing on older entries, which draw as their `kind`. */
  subject?: SubjectKind;
  /** Periods only: the row this era sits in on the overview, such as "Greece". Bob's own words. */
  region?: string;
  /** Periods only: what the era is known for, built from Bob's highlights. */
  themes?: Theme[];
  /** Wikidata id (e.g. "Q913") when the entry came from Wikipedia. Used to spot duplicates. */
  wikidataId?: string;
  /** Set when the entry was drafted with AI and accepted. */
  drafted?: Provenance;
  /** Epoch ms of the last edit. Drives per-item merge when syncing devices. */
  updatedAt: number;
}

/** An entry with a start date: everything the timeline draws. */
export type DatedItem = TimelineItem & { start: HistDate };

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
  /** How the one acted on the other, in Bob's words: "weakened", "funded", "legitimised"… */
  effect?: string;
  /** Highlights that are the evidence for this connection. */
  highlightIds?: string[];
  /** From a territory to a war, battle, alliance or treaty (v9): which side it took part on. */
  side?: 1 | 2;
  drafted?: Provenance;
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

/** Bob's reading of a polity's power at a date, 1 (a sliver) to 5 (dominant); straight lines between points. */
export interface StrengthPoint {
  at: HistDate;
  level: 1 | 2 | 3 | 4 | 5;
  /** Highlights it rests on. */
  highlightIds?: string[];
}

export interface Territory {
  id: string;
  title: string;
  categoryId: string;
  snapshots: TerritorySnapshot[];
  /** Its row on the overview, such as "Greece" (v9). Bob's own words, like a period's `region`. */
  region?: string;
  /** Bob's strength points (v9), which override the thickness its area gives it. */
  strength?: StrengthPoint[];
  /** The timeline entry for this polity (usually a period), if any. */
  itemId?: string;
  wikidataId?: string;
  source?: { name: string; url?: string };
  drafted?: Provenance;
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
  drafted?: Provenance;
  updatedAt: number;
}

/** City-states that fold into one strip on the overview (v9), such as Classical Greece. Its region is its members'. */
export interface PolityGroup {
  id: string;
  title: string;
  territoryIds: string[];
  updatedAt: number;
}

/**
 * A region (v10): one band on the overview, such as Greece. Entries and territories still name
 * their region in Bob's words (`region`); this record is what he renames, merges and deletes,
 * and where its larger area lives.
 */
export interface Region {
  id: string;
  name: string;
  /** The larger area it's in, such as Mediterranean: Bob's word, not another record. */
  parent?: string;
  /** Its place among the bands when Bob has moved it (S8). Unused until then. */
  order?: number;
  /** Where it is on the map (S9): some of Bob's territories, or a drawn shape. Unused until then. */
  outline?: { territoryIds?: string[]; geometry?: Polygon | MultiPolygon };
  updatedAt: number;
}

export const SCHEMA_VERSION = 10;

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
  highlights: Highlight[];
  /** Polity groups (v9). Missing on docs made before v9. */
  groups?: PolityGroup[];
  /** Regions (v10). Missing on docs made before v10; v9's `regionParents` became their `parent`. */
  regions?: Region[];
  /** id → epoch ms when deleted. Lets a merge know a missing item was deleted, not new. */
  deleted: Record<string, number>;
  updatedAt: number;
}
