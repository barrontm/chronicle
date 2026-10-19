# Data model

Source of truth: `src/model/types.ts`. This page explains the why. Schema version: **9**.

```
TimelineDoc
├── categories[]   lanes on the timeline (id, label, color)
├── items[]        entries: event | span | person; start and end dates (a place may have neither)
│     ├── media[]       pictures (commons | url | local)
│     ├── citations[]   → sources (with locator: "pp. 12–15")
│     ├── places[]      {name?, lat, lon, role: site | born | died} for the map
│     ├── lanes[]       politics | war | economy | ideas | technology | nature, several allowed; absent = sorted automatically
│     ├── overview      shown | world: at the top of the overview, or a world event (gold, always shown)
│     ├── dimension     before v9 (political | economic | …); kept, read only by the upgrade
│     ├── subject       what kind of thing it is: person | polity | period | war | battle | event | idea | technology | economy | work | place | migration
│     ├── region        periods only: the overview row it sits in ("Greece"), Bob's own words
│     ├── themes[]      periods only: {id, label, dimension?, highlightIds[]}, what the era is known for
│     └── wikidataId    "Q7259" when added from Wikipedia; spots duplicates
├── notes[]        Bob's write-ups
│     ├── linkedIds[]   → items / series / territories (many-to-many)
│     └── citations[]   → sources
├── sources[]      bibliography (book, article, chapter, lecture, video, web, other)
├── relations[]    connections: fromId → toId, type, effect? ("weakened"), highlightIds[]? (evidence),
│                    side? 1 | 2 (a territory's part in a war, battle, alliance or treaty)
├── highlights[]   passages quoted from a source {text, sourceId, anchor?, lanes[]?, dimension? (before v9), subjectQid?}
│     ├── anchor        {revisionId, section, exact, prefix, suffix, pos}: found again after the page changes
│     └── usedBy[]      → the records it justifies
├── series[]       trends: points {x: decimal year, v: value}, linear | log
│     └── regions{}     per place, for the map: ISO-3 code ("FRA") or territory id → points
├── territories[]  a polity's borders over time
│     ├── snapshots[]   {from, to?, geometry: Polygon | MultiPolygon, areaKm2}; to is exclusive
│     ├── region        its row on the overview ("Greece"), Bob's own words
│     ├── strength[]    {at, level 1–5, highlightIds?}: Bob's reading of its power, straight lines between points
│     └── itemId        → its timeline entry (usually a period)
├── groups[]       city-states that fold into one strip {id, title, territoryIds[]}
├── regionParents{} region → its parent ("Greece" → "Mediterranean"), Bob's own words
├── flows[]        migrations: people moving between places
│     ├── cause         conflict | economic | disaster | forced | settlement | family | unknown
│     ├── measure       moved (people per year) | living (people living abroad)
│     ├── routes[]      {from, to, points {x: decimal year, v: people}}
│     │                   an end is {country: ISO-3} | {territoryId} | {name, lon, lat}
│     └── itemId        → its timeline entry
└── deleted{}      tombstones: id → deletion time (for merging devices)
```

## Choices worth knowing

- **Kinds vs. categories.** A kind decides how something is drawn (point, bar, lifespan). A category is the topic and the lane. New topics never need code.
- **Notes link outward.** A note holds the ids it's about. Items don't list their notes; `notesFor(doc, id)` finds them. One note can compare two people, or tie a person to a war.
- **Citations carry a locator.** Each citation has a locator, so the same book can be cited at different pages from different entries. A source's page lists everything that cites it.
- **Connections are directed.** They're phrased both ways in the UI: "Influenced" seen from Socrates, "Influenced by" seen from Plato. `related` is the undirected fallback.
- **Every record has `updatedAt`.** Mutations set it. `mergeDocs` keeps the newer copy of each record, and a tombstone beats any edit made before it.
- **Deletes cascade gently.** Deleting an entry removes its connections and unlinks it from notes, but the notes survive. Deleting a source strips citations of it and deletes the highlights quoted from it (an unattributed quote is worse than none). Deleting a record unlinks its highlights, which stay; deleting a highlight drops it from connections' evidence and periods' themes.
- **Snapshots, not animation.** A territory is a list of snapshots, each in force from `from` up to (not including) `to`. The map shows whichever is in force for the current year; nothing is interpolated between borders.
- **Values per place live on the trend.** `Series.regions` holds a curve per country or territory. `points` is the headline strip and may be empty for a map-only trend. Removing a territory removes its values (and the trend, if nothing is left).
- **Flows are not trends.** A migration has two ends and a cause, which a `Series` can't hold, so it's its own record. `measure` keeps flows (people moving per year, drawn with moving dashes) apart from stocks (people living abroad, drawn still), and the map scales each separately, so one is never passed off as the other. Routes draw only between their first and last year (whole years count) and interpolate in between. Deleting a territory turns route ends there into named points at its last label point; deleting an entry unlinks its flows.
- **Highlights are not notes.** Text quoted from a reference work is a `Highlight`, shown as a quotation with its source. Notes stay Bob's own words. A highlight lists the records it justifies (`usedBy`), so one passage can back an entry and a connection; `highlightsFor(doc, id)` finds them. Highlights made in the reader carry a text-quote anchor; quotes from before v6 don't.
- **Lanes are not categories.** A category is Bob's topic. A lane is one of six fixed sides of history (Politics and law, War, Economy, Philosophy and religion, Technology, Nature) that a polity or era opens into. An entry or highlight can be in several. `lanesOf(entry, doc)` decides: Bob's lanes win; else the kind of thing (a war is War, an idea Philosophy and religion); else the lanes of its highlights. The automatic sort never overrides what Bob set.
- **The overview mark is Bob's choice.** `overview: 'shown'` puts an entry at the top of the overview; `'world'` makes it a world event, gold and always shown. There is no kind of entry for world events.
- **Polities are territories.** A territory's `region` gives its strip a row, `strength` overrides the thickness its area gives it, and a `group` folds city-states into one strip. A territory can be a connection end; `side` says which side it took part on, so opposite sides of a war are at war and the same side are allied. Deleting a territory takes it out of its groups; deleting a highlight takes it out of strength points.
- **Region parents have no stamp.** `regionParents` merges per region, the newer copy winning. Groups merge like other records.

## Dates

`HistDate = { y, m?, d?, approx? }`, where `y` is astronomical (1 BCE = 0, 431 BCE = -430). Day precision requires a month. Living people have no `end`, nor do places still there; a place whose founding isn't known has no `start`.

## Version history

- **9** (2026-10-19): `lanes` on entries and highlights, `overview` on entries, `region` and `strength` on territories, `groups` and `regionParents` on the doc, `side` on connections. The upgrade fills `lanes` from `dimension` (political → politics, economic → economy, intellectual and religious → ideas, technological → technology; social is left to the automatic sort) and keeps `dimension`. A territory takes its period's `region`. Nothing is restamped, so two devices upgrading the same timeline merge cleanly (`tests/fixtures/sample-history-v8.json`).
- **8** (2026-10-18): a place (`subject: 'place'`) may have no `start` (its founding isn't known), and a place with a start but no `end` is still there. A place with no start is on the map but not the timeline. Every v7 entry is already valid (`tests/fixtures/sample-history-v7.json`).
- **7** (2026-10-18): optional `subject` and `region` on entries. Both stay empty on upgrade, so an older entry draws as its `kind` does; nothing else changes (`tests/fixtures/sample-history-v6.json`).
- **6** (2026-10-17): `highlights` (with text-quote anchors), `dimension` on entries and highlights, `themes` on periods, `effect` and `highlightIds` on connections. Each entry's `excerpt` becomes a highlight with id `h_<entry id>` used by that entry, so two devices upgrading the same timeline agree (`tests/fixtures/sample-history-v5.json`).
- **5** (2026-10-16): optional `drafted` provenance (`{ model, prompt, draftedAt }`) on entries, connections, territories and flows, set when Bob accepts an AI draft. Nothing else changes, so v4 files import as they are (`tests/fixtures/sample-history-v4.json`).
- **4** (2026-10-15): `flows` (migrations). Older files get an empty list (`tests/fixtures/sample-history-v3.json` must keep importing).
- **3** (2026-10-15): territory geometry typed as Polygon/MultiPolygon (other shapes are dropped on import, since v2 never drew them), territory `itemId`/`wikidataId`, series `regions`. `tests/fixtures/sample-history-v2.json` must keep importing.
- **2** (2026-10-15): item `places`, `excerpt`, `wikidataId`; source `accessed`. All optional, so v1 files import unchanged (`tests/fixtures/sample-history-v1.json`).

## Changing the schema

1. Bump `SCHEMA_VERSION` in `types.ts`.
2. Add a migration step at the top of `parseDoc` (N → N+1).
3. Keep a copy of an old-version file in `tests/fixtures/` and test that it imports.
4. Update this page.
