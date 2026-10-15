# Decisions

A log of choices that shouldn't be re-litigated every session. Newest first. To change a decision, add a new entry that supersedes the old one.

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
