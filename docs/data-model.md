# Data model

Source of truth: `src/model/types.ts`. This page explains the why. Schema version: **3**.

```
TimelineDoc
├── categories[]   lanes on the timeline (id, label, color)
├── items[]        entries: event | span | person
│     ├── media[]       pictures (commons | url | local)
│     ├── citations[]   → sources (with locator: "pp. 12–15")
│     ├── places[]      {name?, lat, lon, role: site | born | died} for the map
│     ├── excerpt       quoted reference text {text, sourceId} (e.g. a Wikipedia intro)
│     └── wikidataId    "Q7259" when added from Wikipedia; spots duplicates
├── notes[]        Bob's write-ups
│     ├── linkedIds[]   → items / series / territories (many-to-many)
│     └── citations[]   → sources
├── sources[]      bibliography (book, article, chapter, lecture, video, web, other)
├── relations[]    connections: fromId → toId, type
├── series[]       trends: points {x: decimal year, v: value}, linear | log
│     └── regions{}     per place, for the map: ISO-3 code ("FRA") or territory id → points
├── territories[]  a polity's borders over time
│     ├── snapshots[]   {from, to?, geometry: Polygon | MultiPolygon, areaKm2}; to is exclusive
│     └── itemId        → its timeline entry (usually a period)
└── deleted{}      tombstones: id → deletion time (for merging devices)
```

## Choices worth knowing

- **Kinds vs. categories.** A kind decides how something is drawn (point, bar, lifespan). A category is the topic and the lane. New topics never need code.
- **Notes link outward.** A note holds the ids it's about. Items don't list their notes; `notesFor(doc, id)` finds them. One note can compare two people, or tie a person to a war.
- **Citations carry a locator.** Each citation has a locator, so the same book can be cited at different pages from different entries. A source's page lists everything that cites it.
- **Connections are directed.** They're phrased both ways in the UI: "Influenced" seen from Socrates, "Influenced by" seen from Plato. `related` is the undirected fallback.
- **Every record has `updatedAt`.** Mutations set it. `mergeDocs` keeps the newer copy of each record, and a tombstone beats any edit made before it.
- **Deletes cascade gently.** Deleting an entry removes its connections and unlinks it from notes, but the notes survive. Deleting a source strips citations of it and drops any excerpt quoted from it (an unattributed quote is worse than none).
- **Snapshots, not animation.** A territory is a list of snapshots, each in force from `from` up to (not including) `to`. The map shows whichever is in force for the current year; nothing is interpolated between borders.
- **Values per place live on the trend.** `Series.regions` holds a curve per country or territory. `points` is the headline strip and may be empty for a map-only trend. Removing a territory removes its values (and the trend, if nothing is left).
- **Excerpts are not notes.** Text copied from a reference work lives in `excerpt`, shown as a quotation with its source. Notes stay Bob's own words.

## Dates

`HistDate = { y, m?, d?, approx? }`, where `y` is astronomical (1 BCE = 0, 431 BCE = -430). Day precision requires a month. Living people have no `end`.

## Version history

- **3** (2026-10-15): territory geometry typed as Polygon/MultiPolygon (other shapes are dropped on import, since v2 never drew them), territory `itemId`/`wikidataId`, series `regions`. `tests/fixtures/sample-history-v2.json` must keep importing.
- **2** (2026-10-15): item `places`, `excerpt`, `wikidataId`; source `accessed`. All optional, so v1 files import unchanged (`tests/fixtures/sample-history-v1.json`).

## Changing the schema

1. Bump `SCHEMA_VERSION` in `types.ts`.
2. Add a migration step at the top of `parseDoc` (N → N+1).
3. Keep a copy of an old-version file in `tests/fixtures/` and test that it imports.
4. Update this page.
