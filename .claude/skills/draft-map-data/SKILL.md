---
name: draft-map-data
description: Draft Chronicle map data (territories, flows, entries with places, connections) as an import file Bob reviews and merges, grounded in Wikidata and Pleiades with real citations. Use when Bob asks Claude Code to "draft", "map out" or "fill in" something for the map, or to prototype an AI feature before it is built into the app.
---

# Draft map data

Stage 0 of the AI plan (`docs/decisions.md`, "AI drafts data, never images"): Claude Code is the AI, the app is unchanged. You produce a **draft import file**; Bob opens it with **Import → Merge** and decides. Nothing reaches his timeline without him. Each draft that turns out well is a test case for the in-app feature later (step 6).

## 1. Pin down the request
Ask only what you can't infer: the subject, the years, and the area (a lon/lat box, e.g. the Aegean is about `-10,28,45,48`). If Bob gives a backup export, reuse its category ids so the draft doesn't add duplicate lanes; otherwise make one category with a plain name and a pigment from `docs/design.md`.

## 2. Gather facts before writing anything
Facts come from sources, never from memory. Coordinates in particular must come from a gazetteer.
- **Wikidata** (`https://query.wikidata.org/sparql?format=json&query=…`): dates (P580/P582, P585, P569/P570), coordinates (P625), membership (P463), part of (P361), Pleiades id (P1584).
- **Pleiades** (`https://pleiades.stoa.org/places/<id>/json`, CC BY): ancient places with coordinates and the periods they were in use. Prefer it to Wikidata for Greek and Roman sites.
- **Wikipedia** pages for context, cited as `web` sources with today's date as `accessed`.
- Borders: use historical-basemaps or a published map only as a reference; say in the summary how rough a hand-built polygon is.

Keep a list of claims and where each came from. Drop any claim you can't source, and tell Bob it was dropped.

## 3. Write the file
A schema-5 doc (see `docs/data-model.md`, `src/model/types.ts`) in the scratchpad, named `draft-<subject>.json`:
- Dates as `HistDate` in astronomical years (431 BCE = -430), `approx: true` where the source is vague.
- Every entry cites its sources (`citations` → `sources`); every territory and flow has `source`.
- Ids are fresh (`draft-<slug>-<n>`), each record's `updatedAt` is now. No `deleted`.
- The doc's own top-level `updatedAt` is `0`. Merge takes the title, id and categories from the newer doc, so a newer draft would rename Bob's timeline and replace his lanes.
- Reuse his category ids (the defaults are in `DEFAULT_CATEGORIES`, `src/model/doc.ts`) so the draft lands in an existing lane.
- Quoted reference text goes in `excerpt`, never in a note: notes are Bob's own words, so a draft has **no notes**.
- A route by sea (a fleet, a flow of goods) comes from `node scripts/sea-route.mjs --stops "lon,lat;…"`, ports first and last and capes between, so it never crosses land. Land routes go town to town through sourced places.
- No pictures unless they come from Commons with credit and license. Never generated images.

## 4. Check it
```bash
node scripts/check-draft.mjs <file> --bbox <minLon,minLat,maxLon,maxLat>
```
Fix every error. Fix warnings, or explain them in the summary.

## 5. Hand it over
Tell Bob in a few lines: the file path, what it contains (counts and the year range), which claims are weakest and why, what was dropped, and how to load it (**Import → Merge**, then play the years on the map). Suggest he looks at the map in one or two specific years where the draft changes.

## 6. Keep what worked
When Bob says a draft was good, or after he corrects it, offer to save the request and the corrected result as a case in `tests/ai-evals/<feature>/` (see the `ai-eval` skill): the request, the area, and the properties that must hold (members in a given year, a route's start and end, a date range). Save properties, not the whole file.
