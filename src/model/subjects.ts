import { formatRange, fromWikidataTime } from './dates';
import { newId } from './doc';
import type { HistDate, Relation, RelationType } from './types';

/**
 * What an article is about, from Wikidata: its classes (P31 "instance of" and
 * P279 "subclass of"), walked up the P279 chain until a class Chronicle knows,
 * plus the facts the capture tray shows. Pure; the fetching is in
 * `src/media/wikipedia.ts` (`fetchSubject`).
 */

export type SubjectKind =
  | 'person' | 'polity' | 'period' | 'war' | 'battle' | 'event'
  | 'idea' | 'technology' | 'economy' | 'work' | 'place' | 'migration';

export const KIND_LABEL: Record<SubjectKind, string> = {
  person: 'Person', polity: 'Polity', period: 'Period', war: 'War', battle: 'Battle', event: 'Event',
  idea: 'Movement or idea', technology: 'Technology', economy: 'Economy', work: 'Work', place: 'Place', migration: 'Migration',
};

/**
 * Classes that settle the kind. A new kind of thing is one row here (and one
 * representation module). Subclasses are found by walking P279, so only broad
 * classes are listed, plus a few direct ones that would otherwise be reached
 * the wrong way (a "big city" is also a "free city", which is a state).
 */
const ANCHORS: Record<SubjectKind, string[]> = {
  person: ['Q5'], // human
  battle: ['Q178561', 'Q188055'], // battle, siege
  war: ['Q198', 'Q8465', 'Q103495', 'Q831663'], // war, civil war, world war, military campaign
  migration: ['Q177626', 'Q815962'], // human migration, colonization
  polity: [
    'Q7275', 'Q3024240', 'Q148837', 'Q133442', 'Q6256', 'Q48349', 'Q417175', // state, historical country, polis, city-state, country, empire, kingdom
    'Q170156', 'Q1778834', 'Q1127126', 'Q1063239', // confederation, koinon, military alliance, polity
  ],
  period: ['Q11514315', 'Q6428674', 'Q15401633', 'Q28171280', 'Q8432'], // historical period, era, archaeological period, ancient civilization, civilization
  event: [
    'Q1190554', 'Q140451665', 'Q13418847', 'Q1656682', // occurrence, event, historical event, planned event
    'Q3839081', 'Q44512', 'Q12184', 'Q10931', 'Q45382', 'Q131569', // disaster, epidemic, pandemic, revolution, coup, treaty
  ],
  technology: ['Q11016', 'Q39546', 'Q42889', 'Q11446', 'Q2235308', 'Q1183543', 'Q728', 'Q11019', 'Q2695280'], // technology, tool, vehicle, ship, ship type, device, weapon, machine, technique
  idea: [
    'Q5891', 'Q12765852', 'Q1387659', 'Q7257', 'Q12909644', 'Q9174', // philosophy, philosophical school, school of thought, ideology, political ideology, religion
    'Q2198855', 'Q49773', 'Q968159', 'Q1307214', 'Q17737', // cultural movement, social movement, art movement, form of government, theory
  ],
  economy: ['Q159810', 'Q8142', 'Q405155', 'Q1574938'], // economy, currency, trade route (twice)
  work: ['Q386724', 'Q47461344', 'Q7725634', 'Q838948', 'Q571', 'Q17537576'], // work, written work, literary work, work of art, book, creative work
  place: [
    'Q2221906', 'Q486972', 'Q515', 'Q1549591', 'Q200250', 'Q82794', 'Q1620908', // geographic location, settlement, city, big city, metropolis, region, historical region
    'Q839954', 'Q618123', 'Q41176', 'Q811979', 'Q3257686', // archaeological site, geographical feature, building, built structure, locality
  ],
};

/** When classes of different kinds are equally near, the first kind here wins (a polis that is also an archaeological site is a polity). */
const ORDER: SubjectKind[] = ['person', 'battle', 'war', 'migration', 'polity', 'period', 'event', 'technology', 'idea', 'economy', 'work', 'place'];

const KIND_OF: Record<string, SubjectKind> = Object.fromEntries(
  ORDER.flatMap((k) => ANCHORS[k].map((q) => [q, k])),
);

/** How far up the P279 chain to look. Wikidata's upper classes say little. */
export const MAX_DEPTH = 4;

/** P279 parents per class, as far as they are known. A class with no parents maps to []. */
export type ClassParents = Record<string, string[]>;

/** Walk up level by level. Calls `visit` with each level until it returns something. */
function walk<T>(start: string[], parents: ClassParents, visit: (level: string[], depth: number) => T | undefined): T | undefined {
  const seen = new Set<string>();
  let level = [...new Set(start)];
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const r = visit(level, depth);
    if (r !== undefined) return r;
    level.forEach((q) => seen.add(q));
    level = [...new Set(level.flatMap((q) => parents[q] ?? []))].filter((q) => !seen.has(q));
  }
  return undefined;
}

const kindAt = (level: string[]): SubjectKind | undefined => {
  const kinds = new Set(level.flatMap((q) => (KIND_OF[q] ? [KIND_OF[q]] : [])));
  return ORDER.find((k) => kinds.has(k));
};

/** The kind of the nearest known class: the entity's own classes first, then their parents, and so on. */
export function classify(classIds: string[], parents: ClassParents): SubjectKind | undefined {
  return walk(classIds, parents, kindAt);
}

/** Classes whose parents must be fetched before `classify` can go further; [] when it has its answer or has looked far enough. */
export function classesToFetch(classIds: string[], parents: ClassParents): string[] {
  return walk(classIds, parents, (level, depth) => {
    if (kindAt(level) || depth === MAX_DEPTH) return [];
    const unknown = level.filter((q) => !(q in parents));
    return unknown.length ? unknown : undefined;
  }) ?? [];
}

// ——— Wikidata claims ———

interface Snak { snaktype?: string; datavalue?: { value?: unknown } }
export interface Claim { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]> }
export type Claims = Record<string, Claim[] | undefined>;

/** Wikidata properties Chronicle reads. */
export const P = {
  instanceOf: 'P31', subclassOf: 'P279', born: 'P569', died: 'P570', start: 'P580', end: 'P582', pointInTime: 'P585',
  inception: 'P571', dissolved: 'P576', coords: 'P625', image: 'P18', birthPlace: 'P19', deathPlace: 'P20',
  location: 'P276', circumstances: 'P1480', influencedBy: 'P737',
  partOf: 'P361', follows: 'P155', followedBy: 'P156', participants: 'P710', government: 'P122',
} as const;

const CIRCA = 'Q5727902';

/** Preferred-rank values first, then normal; deprecated values and "unknown value" are skipped. */
export function claimsFor(claims: Claims, prop: string): Claim[] {
  const usable = (claims[prop] ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value');
  const preferred = usable.filter((c) => c.rank === 'preferred');
  return preferred.length ? preferred : usable;
}

export const firstValue = <T>(claims: Claims, prop: string): T | undefined => claimsFor(claims, prop)[0]?.mainsnak?.datavalue?.value as T | undefined;

export function dateClaim(claims: Claims, prop: string): HistDate | undefined {
  const c = claimsFor(claims, prop)[0];
  const v = c?.mainsnak?.datavalue?.value as { time?: string; precision?: number } | undefined;
  if (!v?.time) return undefined;
  const circa = (c?.qualifiers?.[P.circumstances] ?? []).some((q) => (q.datavalue?.value as { id?: string })?.id === CIRCA);
  return fromWikidataTime(v.time, v.precision ?? 9, circa) ?? undefined;
}

export function coordsOf(claims: Claims): { lat: number; lon: number } | undefined {
  const v = firstValue<{ latitude: number; longitude: number }>(claims, P.coords);
  return v ? { lat: v.latitude, lon: v.longitude } : undefined;
}

export const idOf = (claims: Claims, prop: string) => firstValue<{ id?: string }>(claims, prop)?.id;

/** Every usable item value of a property, not just the first. */
export const idsOf = (claims: Claims, prop: string): string[] => [
  ...new Set((claims[prop] ?? [])
    .filter((c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value')
    .flatMap((c) => { const id = (c.mainsnak?.datavalue?.value as { id?: string })?.id; return id ? [id] : []; })),
];

// ——— Subjects ———

export interface SubjectFacts {
  born?: HistDate;
  died?: HistDate;
  /** P580, or P571 (inception) for things that were founded. */
  start?: HistDate;
  /** P582, or P576 (dissolved). */
  end?: HistDate;
  pointInTime?: HistDate;
  coords?: { lat: number; lon: number };
  /** Wikidata ids, in Wikidata's order. */
  partOf: string[];
  follows: string[];
  followedBy: string[];
  participants: string[];
  locations: string[];
  government: string[];
  /** P737 "influenced by". Missing on subjects cached before it was read. */
  influencedBy?: string[];
}

/** An article's subject. Cached with the article, so it shows offline too. */
export interface Subject {
  qid: string;
  /** Wikidata's English label. */
  label?: string;
  /** Unknown when no class or fact says what it is. */
  kind?: SubjectKind;
  facts: SubjectFacts;
  /** English labels of the items the facts point at. */
  labels: Record<string, string>;
}

/** What one Wikidata entity says, before its classes are walked. */
export interface SubjectEntity {
  qid: string;
  label?: string;
  /** Its own classes: P31 values, then P279 values (for types of thing, like the trireme). */
  classIds: string[];
  facts: SubjectFacts;
}

/** A wbgetentities answer (by id or by enwiki title) → the entity, or undefined when the page has no Wikidata item. */
export function parseSubjectEntity(json: unknown): SubjectEntity | undefined {
  const entities = (json as { entities?: Record<string, { id?: string; missing?: string; labels?: { en?: { value?: string } }; claims?: Claims }> })?.entities ?? {};
  const e = Object.values(entities).find((x) => x.id && x.missing === undefined);
  if (!e?.id) return undefined;
  const c = e.claims ?? {};
  return {
    qid: e.id,
    label: e.labels?.en?.value,
    classIds: [...new Set([...idsOf(c, P.instanceOf), ...idsOf(c, P.subclassOf)])],
    facts: {
      born: dateClaim(c, P.born),
      died: dateClaim(c, P.died),
      start: dateClaim(c, P.start) ?? dateClaim(c, P.inception),
      end: dateClaim(c, P.end) ?? dateClaim(c, P.dissolved),
      pointInTime: dateClaim(c, P.pointInTime),
      coords: coordsOf(c),
      partOf: idsOf(c, P.partOf),
      follows: idsOf(c, P.follows),
      followedBy: idsOf(c, P.followedBy),
      participants: idsOf(c, P.participants),
      locations: idsOf(c, P.location),
      government: idsOf(c, P.government),
      influencedBy: idsOf(c, P.influencedBy),
    },
  };
}

/** A WDQS answer to `?c wdt:P279 ?p` → parents for each class asked about (those with none map to []). */
export function parseClassParents(json: unknown, asked: string[]): ClassParents {
  const out: ClassParents = Object.fromEntries(asked.map((q) => [q, []]));
  const rows = (json as { results?: { bindings?: Array<{ c?: { value?: string }; p?: { value?: string } }> } })?.results?.bindings ?? [];
  for (const r of rows) {
    const c = r.c?.value?.split('/').pop();
    const p = r.p?.value?.split('/').pop();
    if (!c || !p || !/^Q\d+$/.test(p)) continue;
    (out[c] ??= []).includes(p) || out[c].push(p);
  }
  return out;
}

/** The SPARQL that asks for the parents of some classes. */
export function classParentsQuery(classIds: string[]): string {
  return `SELECT ?c ?p WHERE { VALUES ?c { ${classIds.map((q) => `wd:${q}`).join(' ')} } ?c wdt:P279 ?p }`;
}

/** When no class is known: someone born is a person; a dated thing an event; a thing with only coordinates a place. */
function kindFromFacts(f: SubjectFacts): SubjectKind | undefined {
  if (f.born || f.died) return 'person';
  if (f.start || f.pointInTime) return 'event';
  if (f.coords) return 'place';
  return undefined;
}

export function toSubject(e: SubjectEntity, parents: ClassParents, labels: Record<string, string>): Subject {
  const kind = classify(e.classIds, parents) ?? kindFromFacts(e.facts);
  return { qid: e.qid, ...(e.label ? { label: e.label } : {}), ...(kind ? { kind } : {}), facts: e.facts, labels };
}

/** Items the facts point at, whose labels the header and tray show. Wikidata takes 50 ids per call. */
export function linkedIds(f: SubjectFacts): string[] {
  return [...new Set([...f.partOf, ...f.follows, ...f.followedBy, ...f.participants, ...f.locations, ...f.government])].slice(0, 50);
}

/** The subject's dates, as the header shows them: a life, a span, or a moment. */
export function subjectWhen(s: Subject): string | undefined {
  const f = s.facts;
  if (s.kind === 'person' && (f.born || f.died)) {
    if (f.born && f.died) return formatRange(f.born, f.died);
    return f.born ? `born ${formatRange(f.born)}` : `died ${formatRange(f.died!)}`;
  }
  if (f.pointInTime) return formatRange(f.pointInTime);
  if (f.start) return formatRange(f.start, f.end);
  if (f.end) return `until ${formatRange(f.end)}`;
  return undefined;
}

/** "Part of …" for the header, when Wikidata names what it was part of. */
export function subjectPartOf(s: Subject): string | undefined {
  const names = s.facts.partOf.flatMap((q) => (s.labels[q] ? [s.labels[q]] : []));
  return names.length ? names.slice(0, 2).join(', ') : undefined;
}

/** The entry or territory Bob already has for this subject, matched by Wikidata id. */
export function findInChronicle<T extends { id: string; wikidataId?: string }>(records: T[], qid: string): T | undefined {
  return records.find((r) => r.wikidataId === qid);
}

/** One line of the capture tray's facts. `qids` are the items named, in order, so the tray can mark those Bob already has. */
export interface FactLine {
  label: string;
  values: { text: string; qid?: string }[];
  /** True when the subject has coordinates, so adding it puts a pin on the map. */
  pin?: boolean;
}

/** The facts the capture tray shows for a subject: When, Where, Part of, then whatever else Wikidata says. Items without an English label are left out. */
export function subjectFacts(s: Subject, max = 3): FactLine[] {
  const f = s.facts;
  const named = (ids: string[]) => ids.flatMap((qid) => (s.labels[qid] ? [{ text: s.labels[qid], qid }] : [])).slice(0, max);
  const out: FactLine[] = [];
  const when = subjectWhen(s);
  if (when) out.push({ label: 'When', values: [{ text: when }] });
  const where = named(f.locations);
  if (where.length) out.push({ label: 'Where', values: where, ...(f.coords ? { pin: true } : {}) });
  else if (f.coords) out.push({ label: 'Where', values: [{ text: `${Math.abs(f.coords.lat).toFixed(2)}° ${f.coords.lat < 0 ? 'S' : 'N'}, ${Math.abs(f.coords.lon).toFixed(2)}° ${f.coords.lon < 0 ? 'W' : 'E'}` }], pin: true });
  const rows: [string, string[]][] = [
    ['Part of', f.partOf], ['Who took part', f.participants], ['Government', f.government], ['After', f.follows], ['Before', f.followedBy],
  ];
  for (const [label, ids] of rows) {
    const values = named(ids);
    if (values.length) out.push({ label, values });
  }
  return out;
}

// ——— Connections from facts ———

/**
 * Which facts become which connections, in the order they're suggested. `out`:
 * the subject is the "from" end ("Salamis is part of the invasion"); `in`: the
 * record it names is ("what it follows led to it").
 */
const FACT_RELATIONS: { fact: keyof SubjectFacts | 'influenced'; type: RelationType; dir: 'out' | 'in' }[] = [
  { fact: 'partOf', type: 'part-of', dir: 'out' },
  { fact: 'follows', type: 'caused', dir: 'in' },
  { fact: 'followedBy', type: 'caused', dir: 'out' },
  { fact: 'influencedBy', type: 'influenced', dir: 'in' },
  { fact: 'influenced', type: 'influenced', dir: 'out' },
  { fact: 'participants', type: 'related', dir: 'out' },
  { fact: 'locations', type: 'related', dir: 'out' },
];

/**
 * Suggested connections between the entry for a subject and entries Bob
 * already has, from the subject's Wikidata facts: part of → part of, follows
 * and followed by → led to, influenced by → influenced, participants and
 * location → related. Each cites `highlightId` when there is one. At most one
 * per entry, and none that Bob already has. `influenced` (who this person
 * influenced) comes from a separate search, so it's passed in.
 */
export function factRelations(
  itemId: string,
  facts: Partial<SubjectFacts> & { influenced?: string[] },
  doc: { items: { id: string; wikidataId?: string }[]; relations: Relation[] },
  highlightId?: string,
): Relation[] {
  const byQid = new Map(doc.items.filter((i) => i.wikidataId && i.id !== itemId).map((i) => [i.wikidataId!, i.id]));
  const connected = new Set(doc.relations.flatMap((r) => (r.fromId === itemId ? [r.toId] : r.toId === itemId ? [r.fromId] : [])));
  const out: Relation[] = [];
  for (const { fact, type, dir } of FACT_RELATIONS) {
    for (const qid of (facts[fact] as string[] | undefined) ?? []) {
      const other = byQid.get(qid);
      if (!other || connected.has(other)) continue;
      connected.add(other);
      out.push({
        id: newId('r'),
        fromId: dir === 'out' ? itemId : other,
        toId: dir === 'out' ? other : itemId,
        type,
        ...(highlightId ? { highlightIds: [highlightId] } : {}),
        updatedAt: 0,
      });
    }
  }
  return out;
}
