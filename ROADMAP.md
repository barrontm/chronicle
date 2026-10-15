# Roadmap

Milestones are ordered and each one ships something usable. Tick items as they land, and record decisions in `docs/decisions.md`.

## M1 — Foundation ✅ (2026-10-15)
- [x] Entries (event / period / person) with BCE-aware dates and approximate dates
- [x] Category lanes with show/hide
- [x] Notes linked to many entries, a bibliography of sources, and citations with page locators
- [x] Connections between entries (influenced, led to, part of, responded to, related)
- [x] Pictures: Wikimedia Commons search with credit and license, image links, uploads
- [x] Trend strips aligned to the timeline: paste data or import from Our World in Data, log scale
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

## M3 — Sync across devices
- [ ] A remote copy that both devices can reach. Leading option: a JSON file in a private GitHub repo via the API (free, versioned history, one token). Alternative: a small Cloudflare Worker with KV.
- [ ] Sync loop: pull, `mergeDocs`, push; run on open, on focus, and after edits
- [ ] Uploaded pictures sync too (or move to remote storage)

## M4 — Maps: territory over time
- [ ] Map panel (MapLibre GL, offline-capable vector basemap) with a year slider tied to the timeline
- [ ] Territories drawn from GeoJSON snapshots, with import from the historical-basemaps dataset
- [ ] Optional: place entries on the map (battle sites, birthplaces)

## M5 — Seeing connections
- [ ] Connection graph view (who influenced whom, causal chains), filterable by category and era
- [ ] "Meanwhile" view: what else was happening during the selected entry's dates
- [ ] Technology lineages: chains of "led to" connections drawn as a branching tree

## M6 — Learning
- [ ] Review mode: quiz yourself from your own entries (dates, order, connections) with spaced repetition
- [ ] Reading log: per source, what you've read and what you added from it
- [ ] Printable or exportable study sheets for an era

## Known limits
- Deep time (beyond about ±271,000 years) needs a custom renderer.
- Thumbnails of uploaded pictures don't show on the timeline bars yet, only in the panel.
