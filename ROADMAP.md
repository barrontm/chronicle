# Roadmap

Milestones are ordered and each one ships something usable. Tick items as they land, and record decisions in `docs/decisions.md`.

## Next tickets
One ticket per session, on its own branch: start fresh, finish with a commit, tick it below. Each ticket says which manual section changes (`docs/manual.md`). Ordered by value to learning and curiosity per effort. Size: S ≈ one sitting, M ≈ a longer one. Model: what to run it on (`/model …`).

Tickets marked 🏛 make the map good for Ancient Greece and its wars (city-state borders, alliances, campaigns). They come first because Bob is studying that now.

1. **Place picker** · S · sonnet. Set an entry's places by hand (name plus coordinates; "Look up" via Wikidata search is a bonus), so hand-made entries get map pins. 🏛 Battles need this to appear on the map.
   Files: `src/ui/panels/ItemPanels.tsx` (places section in `ItemEditor`), `src/media/wikipedia.ts` (coordinate lookup). Could also offer "Pick on the map", reusing `nav.draw`'s pattern.
   Done when: add, edit and remove places in the editor; an e2e test adds a place and sees the pin label on the map.
2. 🏛 **Detailed Aegean coast** · S · sonnet. Bundle a Natural Earth 10m land and coastline layer clipped to the Mediterranean (about lon −10…45, lat 28…48), shown from zoom 5, and raise `maxZoom` to 12.
   Files: `scripts/build-geo.ts`, `src/ui/MapView.tsx`, precache list.
   Done when: Aegina and Salamis are recognizable at zoom 9 and the size change is noted in `docs/decisions.md`.
3. 🏛 **Edit borders over time** · M · opus. Drag, add and delete the vertices of an existing snapshot; "Copy to new dates" (Athens after 338 BCE from Athens before). Show a pending drawn shape on the map while its form is open.
   Files: `src/ui/drawing.ts` (edit operations, tested), `MapView.tsx` (vertex dragging), `TerritoryEditor` in `src/ui/panels/TerritoryPanels.tsx`.
   Done when: an e2e test copies a snapshot, moves one vertex and sees the new area.
4. 🏛 **Alliances** · M · opusplan. Schema v4. `Alliance { id, title, color, itemId?, members: { territoryId, from, to? }[], updatedAt }`, plus a map option "Color by alliance" that tints members by bloc for the current year, with a legend.
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, a membership query in `src/ui/mapData.ts` (tested), a new panel.
   Done when: the Delian League's membership changes as the year plays (fixture test data), and merge handles alliances.
5. 🏛 **Campaign routes** · M · opusplan. Schema bump. `TimelineItem.routes?: { name?, points: [lon,lat][] }[]`, drawn with the draw tool in line mode and shown as arrowed lines while the entry is within its dates.
   Files: `src/ui/drawing.ts` (line mode), `MapView.tsx` (route and arrow layers), `ItemEditor`.
   Done when: a test campaign draws a route with an arrow in its year and none outside it.
6. 🏛 **War view and battle pins** · S · sonnet. War-category events get a distinct pin. A span entry offers "Show this war on the map", which filters to it and its `part-of` children, shows their routes, and fits the bounds.
   Files: `src/ui/mapData.ts` (filter, tested), `MapView.tsx`, `ItemView`.
   Done when: an e2e test opens a war and sees only its battles.
7. **Meanwhile** · M · opusplan. On an entry, show "Meanwhile…": other entries overlapping its dates, grouped by category, plus territories in force.
   Files: new query in `src/model/atYear.ts` (unit-tested), `ItemView` in `src/ui/panels/ItemPanels.tsx`.
   Done when: it lists overlapping entries, links open them, and an empty state invites adding one.
8. **Review mode** · M · opusplan. Quiz yourself from your own entries: put three in order, guess a year, name a connection. Plain spaced repetition stored per entry.
   Files: new `src/model/review.ts` (pure, tested), new panel `src/ui/panels/Review.tsx`, plus a schema bump if review state is saved in the doc (see `src/model/CLAUDE.md`).
   Done when: a session of 10 questions runs offline from the fixture, and answers change what comes next.
9. **Search** · S · sonnet. Top-bar search across entries, notes and sources that jumps to the result.
   Files: `src/ui/App.tsx`, reuse the matching in `src/ui/panels/Library.tsx`.
   Done when: typing finds all three kinds and Enter opens the first; covered by an e2e test.
10. **Tech tree** · M · sonnet. Chains of "led to" connections among technology entries, drawn as an era-columned tree in plain SVG.
   Files: new `src/ui/TechTree.tsx`, layout logic in a pure, tested module.
   Done when: the fixture's technology chain renders, and clicking a node opens it.
11. **Backup reminder** · S · haiku. Remind after 14 days without an export.
   Files: `src/ui/App.tsx` (store the last export date with `useStored`).
   Done when: the reminder shows once, and exporting or dismissing hides it.
12. **Bubbles for counts, click a country for its curve** · M · opus. Totals (people, migrants, $) become circles at country centroids (`labelPoint` over the bundled countries), area ∝ value, scaled to the maximum over all years so growth shows as the year plays; rates keep shading. `defaultMapStyle(series)` guesses from the unit; a "Show as: Shades / Bubbles" toggle (per trend, `useStored`) overrides. The legend gets reference circles. Clicking a country opens a sparkline with the current year marked.
   Files: `src/ui/mapData.ts` (`countryBubbles`, `defaultMapStyle`, tested), `MapView.tsx` (bubbles layer, popover), `MapPane.tsx` (toggle, legend).
   Done when: an e2e test switches a population trend to bubbles and sees the bubble legend.
13. **Migration by origin and destination** · M · opus. A script converts UN DESA "International Migrant Stock 2024: Destination and Origin" (1990–2024; total, men, women) into `public/data/migration/<ISO3>.json`, fetched on demand. The catalogue gains "Immigrants to X by country of origin" and "Emigrants from X by destination"; importing one makes a regional `Series` keyed by the partner country, shown as bubbles (ticket 12). First confirm the UN download URL and file sizes.
   Files: `scripts/build-migration.ts`, `scripts/build-trend-index.ts`, `src/data/trendCatalog.ts`, `SeriesEditor.tsx`.
   Done when: a mocked e2e test imports "Emigrants from Ireland by destination" and sees a bubble on the United States.

## M1 — Foundation ✅ (2026-10-15)
- [x] Entries (event / period / person) with BCE-aware dates and approximate dates
- [x] Category lanes with show/hide
- [x] Notes linked to many entries, a bibliography of sources, and citations with page locators
- [x] Connections between entries (influenced, led to, part of, responded to, related)
- [x] Pictures: Wikimedia Commons search with credit and license, image links, uploads
- [x] Trend strips aligned to the timeline: paste data or import from Our World in Data, log scale
- [x] Find a trend: search Our World in Data and World Bank datasets (catalogue bundled for offline search)
- [x] Offline PWA, IndexedDB storage, export backup, import with merge
- [x] Unit tests, e2e tests, CI, deploy workflow

## M2 — Daily use
- [ ] Deploy to GitHub Pages and install on phone and laptop
- [ ] Search across entries, notes and sources (top bar, jump to result)
- [ ] Drag an entry on the timeline to change its dates (keep the stored precision)
- [ ] Edit categories: rename, recolor, add, reorder
- [ ] Markdown in notes, with `[[Entry name]]` links that resolve to entries
- [ ] Tags and a filter by tag
- [ ] Reminder to export a backup if none has been made in 14 days
- [x] User manual in the app (Help), updated with every change
- [x] Saved data upgrades on open (old copy kept); an older app never overwrites newer data; updates wait for Reload

## M2.5 — Quick capture
- [x] Add from Wikipedia: search, then a prefilled entry (kind, dates and places from Wikidata, picture with credit, intro as a quoted excerpt, page cited as a source); duplicates detected by Wikidata id
- [ ] Place picker in the entry editor (click a mini-map or type coordinates); for now places come from Wikipedia

## M3 — Sync across devices
- [ ] A remote copy that both devices can reach. Leading option: a JSON file in a private GitHub repo via the API (free, versioned history, one token). Alternative: a small Cloudflare Worker with KV.
- [ ] Sync loop: pull, `mergeDocs`, push; run on open, on focus, and after edits
- [ ] Uploaded pictures sync too (or move to remote storage)

## M4 — Maps: change over time, Civ-style ✅ (2026-10-15)
- [x] Map view (MapLibre GL, only `MapView.tsx` imports it) on a bundled, tile-free Natural Earth basemap; Timeline | Map | Split
- [x] Shared current year: playhead on the timeline, year slider and Play on the map
- [x] Territories: import a polity across all snapshots from historical-basemaps, simplified on import, drawn in category pigment for the current year
- [x] Reference borders backdrop (opt-in, fetched and cached, never saved to the doc)
- [x] Entries with places as pins while the current year is within their dates; optional connection arcs
- [x] Regional trends (`Series.regions`), OWID "all countries" import, choropleth with legend; territory values as proportional circles
- [x] Tech spread: technology entries appear in date order as the year plays (keep past entries + show one category)
- [x] Draw a territory by hand or bring a GeoJSON file, for polities the dataset lacks; snapshot dates editable
- [ ] Interpolate a territory's area as a trend (from its snapshots)

## M5 — Seeing connections
- [x] Influences on the timeline: click a person to light up who influenced them and whom they influenced, with arrows; suggestions from Wikipedia (Wikidata "influenced by")
- [ ] Connection graph view (who influenced whom, causal chains), filterable by category and era
- [ ] "Meanwhile" view: what else was happening during the selected entry's dates
- [ ] Technology lineages: chains of "led to" connections drawn as a branching tree (may move into M4 as the tech tree)

## M6 — Learning
- [ ] Review mode: quiz yourself from your own entries (dates, order, connections) with spaced repetition
- [ ] Reading log: per source, what you've read and what you added from it
- [ ] Printable or exportable study sheets for an era

## Known limits
- Deep time (beyond about ±271,000 years) needs a custom renderer.
- Thumbnails of uploaded pictures don't show on the timeline bars yet, only in the panel.
