# Chronicle — project briefing for Claude

Bob's personal history timeline: a **learning tool** he fills in himself as he studies, a home for his notes, and something fun that sparks curiosity. Ships with no content. Every change should make it easier to record what he learned, connect it, and find it again.

Start from the ticket in `ROADMAP.md`. Read `docs/decisions.md` only when a ticket changes architecture.

## What exists
Entries (`event` / `span` / `person`; topics are **categories**, never kinds) · notes linked to anything · sources with citations · connections · trends (`Series`, incl. per-country `regions`) · pictures (Commons, link, upload) · add from Wikipedia · map with territories, pins, choropleth and one shared year · offline PWA (IndexedDB, export/import with merge).

## Commands
```bash
npm run dev           # dev server
npm run check:quiet   # typecheck + unit + build + e2e, failures only: run before every commit
npm run check         # same, full output: only when debugging a failure
npm run shots -- --only map --sheet   # screenshots of the views you touched, tiled into one image
npx playwright test e2e/visual.spec.ts --update-snapshots   # after an intended visual change
```

## Layout
```
src/model/   types.ts (schema), dates.ts (ALL date logic), doc.ts (pure mutations, merge), atYear.ts
src/data/    series/OWID parsing, geo.ts, basemaps.ts
src/media/   Commons, Wikipedia/Wikidata
src/ui/      React; TimelineView = only vis-timeline importer, MapView = only maplibre-gl importer
e2e/         Playwright specs        tests/fixtures/  TEST DATA ONLY
docs/        decisions.md, data-model.md, design.md
```
Folder notes load automatically: `src/ui/CLAUDE.md`, `src/model/CLAUDE.md`, `e2e/CLAUDE.md`.

## Rules
1. **Dates** only via `src/model/dates.ts` (astronomical years; 431 BCE = -430). Never `new Date(y, …)`.
2. **Mutations** only through `upsert` / `remove` (via `update()` from `useDoc()`).
3. **Schema changes** follow the checklist in `src/model/CLAUDE.md`. Old backups must always import.
4. **No content** in the app, and **no AI-generated imagery**.
5. **Offline first.** Network features say clearly when offline.
6. **Copy:** plain, sentence-case, Bob's point of view (see `docs/design.md`).
7. **Verify visually** with screenshots of only the views you changed (desktop, phone, dark), as one sheet. The `design-review` skill does this; the Playwright MCP server (`.mcp.json`) is for hover, drag and scrubbing.
8. **Tests with features:** unit tests for logic, one e2e test for the main flow, network mocked.
9. **Manual:** every user-visible change updates `docs/manual.md` (shown in the app under Help) in the same commit, in Bob's words. `check:quiet` fails otherwise; "Manual: none" in a commit message is only for changes Bob can't see.

## Releases: Bob's stable app
- `main` is Bob's stable app on GitHub Pages; pushing `main` deploys it (only after the full check passes in CI).
- Work each ticket on its own branch from `main` (`ticket/<slug>`). Never commit tickets to `main`.
- Done = `check:quiet` passes, manual updated, committed on the branch. Then ask Bob; merge to `main` and push only when he says to release.
- Saved data must open in every later version: schema changes follow `src/model/CLAUDE.md`, including its upgrade test.

## Working efficiently
- One roadmap ticket per session. Start fresh, finish with a commit.
- Read line ranges, not whole files. Never read `public/geo`, `dist`, lockfiles or minified libraries; use `.d.ts` files or a narrow `grep -o`.
- Pipe noisy commands through `tail` / `grep`. Subagents only for wide searches.

## Compact instructions
When compacting, keep: the current ticket, decisions made, files touched, failing test names and errors still open. Drop: tool output, screenshots, resolved errors, file contents.
