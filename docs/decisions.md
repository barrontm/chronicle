# Decisions

A log of choices that shouldn't be re-litigated every session. Newest first. To change a decision, add a new entry that supersedes the old one.

## 2026-10-15 — Find a trend: a bundled catalogue, numbers fetched live
Bob searches Our World in Data (graphers listed in its sitemap) and the World Bank's World Development Indicators in one box. `scripts/build-trend-index.ts` builds `public/data/trend-index.json` ahead of time: titles, units, year ranges and one-line descriptions, never values. It is committed and precached, so search works offline, and it's rerun by hand now and then. It lists datasets; it isn't content, and the app still ships no history. Numbers are fetched only when Bob picks a dataset, and they're cached NetworkFirst. Both sources allow cross-origin requests. World Bank results become the same `TrendTable` as OWID CSVs, so one chooser serves both; WB aggregates (listed in the index) are choosable by name but never shade the map. No schema change: a found trend is an ordinary `Series` with `source`. OWID writes BCE years as plain negatives (-10000 = 10,000 BCE), so `fromOwidYear` in `dates.ts` shifts them by one; trends imported before this fix keep their one-year offset (invisible at those scales). Next: migration as flows between places (arrows by rate and cause, a new `Flow` record, since flows have two ends and a cause that a `Series` can't hold), fed by Bob's own historical migrations, UNHCR refugees (cause known, 1951 on) and Abel & Cohen bilateral flows (1990–2020, all reasons). UN DESA migrant stocks were dropped: they count people living abroad, not people moving. Then bubbles for counts.

## 2026-10-15 — A stable app, a manual in it, and data that carries forward
`main` is Bob's stable app on GitHub Pages and deploys only after the full check (including e2e) passes; tickets live on branches and are released when Bob says so. The dev server runs on localhost, a different origin, so its IndexedDB test data never touches his real timeline.
Saved docs used to load without migration (only imports ran `parseDoc`'s migrations). Now `openStoredDoc` upgrades them on open, after keeping an untouched copy in a `backups` store (last 5). A doc from a newer schema opens read-only, and `IdbStore.save` refuses to write over one, so a stale tab can't drop fields it doesn't know. The service worker uses `prompt`, not `autoUpdate`: a banner offers **Reload** (after flushing the save) instead of reloading mid-edit.
The manual is `docs/manual.md`, bundled with `?raw` and rendered by a small Markdown subset (`ui/markdown.ts`, no HTML strings, web and anchor links only) in a Help panel that works offline. `scripts/check-manual.mjs` fails `check` on a branch that changes `src/` (app code) without it; "Manual: none" in a commit message is the escape hatch. Help shows the build's commit and date (`__APP_VERSION__`).

## 2026-10-15 — Borders Bob draws or brings: city-states without a dataset
There is no open dataset of Greek city-state borders over time, and historical-basemaps has only three maps for Classical Greece (500, 400 and 323 BCE), at a resolution where poleis vanish. So Bob can draw a territory on the map (click points; extra parts for islands; drawing logic in the pure `ui/drawing.ts`) or bring areas from a GeoJSON file (geojson.io, QGIS, a paper's data). Both work offline and need no schema change: a drawn shape is just a `TerritorySnapshot` with dates he types. User files are simplified at a fine level (0.001°, 4 decimals) so small poleis and islands survive; historical-basemaps imports keep 0.05°. Snapshot dates are now editable, so borders can change at any year, not only at dataset years. The app still ships no borders of its own.

## 2026-10-15 — Map: MapLibre behind an adapter, no tiles, borders Bob chooses
The map (MapLibre GL 6, pinned) follows the vis-timeline rule: only `src/ui/MapView.tsx` imports it, and the logic that decides what is on the map in a year lives in pure modules (`model/atYear.ts`, `ui/mapData.ts`). There is no tile server: a simplified Natural Earth basemap (countries, lakes, rivers, about 1 MB) is bundled in `public/geo` and precached, so the map works offline. Labels are HTML markers, because symbol text needs a glyph server.
Borders come from historical-basemaps (GPL-3.0, credited on each territory). Bob imports the polities he studies; each import is simplified (Douglas–Peucker, 0.05°) so backups stay small, and it can extend an existing territory (Roman Republic → Roman Empire). The full world maps appear only as an opt-in "reference borders" backdrop, which is fetched, cached by the service worker, and never written to the doc, so the app still ships no history.
Trends gain `regions` (ISO-3 codes or territory ids). Countries are shaded on today's borders, as Our World in Data does, and the legend says so; territory values are circles. The color scale is fixed over all years so change over time is visible. "Tech spread" is the map with past entries kept and one category shown; a separate tech tree stays in M5.

## 2026-10-15 — Add from Wikipedia: facts, a citation and a quote, never a note
"Add → From Wikipedia" prefills the normal entry editor and saves nothing until Bob confirms. Kind and dates come from Wikidata (precision kept, BCE converted in `dates.ts`), not from parsing article prose. The picture comes from Wikidata's P18 via Commons so credit and license are real; the page's own lead image may be non-free and is not used. The page becomes a `web` source with the date read. The intro is stored as an `excerpt` and shown as a quotation, so reference text never passes for Bob's own understanding. SEP was considered and dropped: it has no API and blocks cross-site requests.

## 2026-10-15 — Learning tool, empty by default
Bob builds the timeline himself as he learns, so the app starts empty with an invitation to add the first entry. Sample history exists only as a test fixture. Notes, sources and connections are first-class, because the value is in his own understanding and how things link, not in coverage.

## 2026-10-15 — Real pictures, not AI images
Pictures come from Wikimedia Commons (credit and license captured automatically), image links, or uploads. AI-generated images of real history can quietly mislead, so they're out of scope. Change over time is shown with non-AI visualizations: trend strips (now), territory maps (planned), and connection graphs (planned).

## 2026-10-15 — Sync: one person, many devices → per-record last-writer-wins
"Online editing" means Bob on his own devices, not collaboration. Every record has an `updatedAt` and deletions leave tombstones (`doc.deleted`), so `mergeDocs` can combine two copies safely. CRDTs (Yjs/Automerge) were considered and rejected as unnecessary complexity for one editor. Interim sync is export on one device, then **Import → Merge** on the other. Automatic sync (see ROADMAP) will reuse `mergeDocs` against a remote copy.

## 2026-10-15 — Local-first PWA
React, TypeScript, Vite and vite-plugin-pwa, with IndexedDB via `idb`. Works fully offline once loaded. Hosting is static (GitHub Pages). Persistence goes through the `DocStore` interface, so sync wraps a store instead of changing callers.

## 2026-10-15 — vis-timeline behind an adapter
Mature, editable, and supports lanes. Only `src/ui/TimelineView.tsx` imports it. Known limit: JS Dates reach about ±271,000 years, enough for human history but not deep time. A custom renderer would replace the adapter if that's ever needed.

## 2026-10-15 — Trends are our own SVG, not vis Graph2d
Graph2d has no log scale and styles poorly. Trend strips are small SVGs that read the timeline's visible window, so they pan and zoom with it. Each strip has its own y-scale: they show shape, not cross-series magnitude.

## 2026-10-15 — Astronomical year numbering internally
431 BCE is stored as -430, so arithmetic just works. Display and input happen only in `dates.ts`. Typing "-431" means 431 BCE (the historian's sense), not ISO's astronomical meaning. Axis ticks at decade-or-wider zoom show round numbers ("500 BCE" for tick -500), accepting a one-year offset that is invisible at that scale.

## 2026-10-15 — Fonts bundled, not from Google Fonts
Spectral (reading text) and Public Sans (interface) come from `@fontsource` so they work offline.
