# Data model

Source of truth: `src/model/types.ts`. This page explains the why. Schema version: **1**.

```
TimelineDoc
├── categories[]   lanes on the timeline (id, label, color)
├── items[]        entries: event | span | person
│     ├── media[]       pictures (commons | url | local)
│     └── citations[]   → sources (with locator: "pp. 12–15")
├── notes[]        Bob's write-ups
│     ├── linkedIds[]   → items / series / territories (many-to-many)
│     └── citations[]   → sources
├── sources[]      bibliography (book, article, chapter, lecture, video, web, other)
├── relations[]    connections: fromId → toId, type
├── series[]       trends: points {x: decimal year, v: value}, linear | log
├── territories[]  extent over time as GeoJSON snapshots (not yet rendered)
└── deleted{}      tombstones: id → deletion time (for merging devices)
```

## Choices worth knowing

- **Kinds vs. categories.** A kind decides how something is drawn (point, bar, lifespan). A category is the topic and the lane. New topics never need code.
- **Notes link outward.** A note holds the ids it's about. Items don't list their notes; `notesFor(doc, id)` finds them. One note can compare two people, or tie a person to a war.
- **Citations carry a locator.** Each citation has a locator, so the same book can be cited at different pages from different entries. A source's page lists everything that cites it.
- **Connections are directed.** They're phrased both ways in the UI: "Influenced" seen from Socrates, "Influenced by" seen from Plato. `related` is the undirected fallback.
- **Every record has `updatedAt`.** Mutations set it. `mergeDocs` keeps the newer copy of each record, and a tombstone beats any edit made before it.
- **Deletes cascade gently.** Deleting an entry removes its connections and unlinks it from notes, but the notes survive. Deleting a source strips citations of it.

## Dates

`HistDate = { y, m?, d?, approx? }`, where `y` is astronomical (1 BCE = 0, 431 BCE = -430). Day precision requires a month. Living people have no `end`.

## Changing the schema

1. Bump `SCHEMA_VERSION` in `types.ts`.
2. Add a migration step at the top of `parseDoc` (N → N+1).
3. Keep a copy of an old-version file in `tests/fixtures/` and test that it imports.
4. Update this page.
