# Chronicle — project briefing for Claude

Chronicle is Bob's personal history timeline. It is a **learning tool**: he builds it himself, entry by entry, as he reads and studies history. It is not a reference database and it ships with no content. Every design decision should make it easier to record what he learned, connect it to what he already knows, and find it again.

Read `docs/decisions.md` before proposing architecture changes, and `ROADMAP.md` before starting new work.

## What exists

- **Entries** (`TimelineItem`) of three kinds: `event` (a moment), `span` (a war, reign or movement), `person` (a lifespan). Topics such as war or science are **categories**, never kinds.
- **Notes**: Bob's own write-ups, each linked to any number of entries or trends.
- **Sources**: bibliography entries, cited from entries and notes with an optional locator (pages, chapter, timestamp).
- **Connections** (`Relation`): directed links between entries, such as influenced, caused, part-of, responded-to and related.
- **Trends** (`Series`): quantities over time (population, literacy, transistor counts), drawn as strips that share the timeline's time axis. They can be typed in, pasted, or imported from an Our World in Data chart.
- **Pictures** (`MediaRef`) on entries: Wikimedia Commons search (credit and license saved), an image link, or an upload stored in IndexedDB.
- **Territories**: in the schema, not rendered yet (see ROADMAP "Maps").
- Offline-first PWA. Data lives in IndexedDB. Export/import JSON, where import can **merge**; that is the cross-device sync until real sync lands.

## Commands

```bash
npm run dev          # local dev server
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests (model, dates, parsing, store)
npm run test:e2e     # Playwright against the production build (vite preview)
npm run check        # all of the above plus build: run before every commit
```

In the Claude cloud sandbox Playwright can't download browsers. Run e2e with the preinstalled Chromium:
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`

## Layout

```
src/model/      types.ts (schema), dates.ts (ALL date logic), doc.ts (pure mutations, validation, merge)
src/store/      DocStore interface, IndexedDB + in-memory implementations
src/data/       parsing pasted series data and Our World in Data CSVs
src/media/      Wikimedia Commons search, image shrinking
src/ui/         React. TimelineView is the ONLY file that imports vis-timeline
src/ui/panels/  drawer contents: entry, note, source and trend views/editors, library
tests/fixtures/ sample-history.json (TEST DATA ONLY; never ship it as app content)
e2e/            Playwright specs
docs/           decisions.md, data-model.md, design.md
```

## Rules

1. **Dates.** Years are stored astronomically (431 BCE = -430). Only `src/model/dates.ts` converts. Never use `new Date(y, …)` for historical years; use `toJsDate`. Any date change needs unit tests, including BCE, year 0–99, and leap days.
2. **Mutations are pure.** Change the doc only through `upsert` / `remove` in `src/model/doc.ts`, via `update()` from `useDoc()`. They stamp `updatedAt` and record tombstones, which merge depends on. `remove` cascades: it drops connections and unlinks notes, but never deletes Bob's notes.
3. **Schema changes.** Bump `SCHEMA_VERSION`, add a migration in `parseDoc`, update `docs/data-model.md` and the fixture, and add a test that an old file still imports. Old backups must always import.
4. **No content in the app.** Never seed the app with history. The fixture is for tests and screenshots.
5. **No AI-generated imagery.** Pictures are real artifacts, monuments, portraits and artworks with credit and license. Non-AI visualizations (trends, maps, connections) are the way to show change over time.
6. **Offline.** Every feature must work offline, except features that fetch from the network (Commons search, OWID import). Those must say so clearly when offline instead of failing silently.
7. **Copy.** Use plain, sentence-case labels from Bob's point of view ("Write a note", "Add to timeline"). Errors say what happened and how to fix it. See `docs/design.md`.
8. **Verify visually.** For UI changes, build, take screenshots with Playwright (desktop 1440×900, phone 412×860, dark mode) and look at them before calling the work done.
9. **Tests with features.** A new feature gets unit tests for its logic and at least one e2e test for the main flow. Network calls in e2e are mocked with `page.route` (remember CORS headers).

## Gotchas

- React bubbles synthetic events through portals. Forms inside `ImagePicker` call `stopPropagation()` so they don't submit the entry form behind them.
- vis-timeline label callbacks receive moment objects even though the types say `Date`. The timeline runs in UTC via the `moment` option.
- `Field` ties a label to its control by id. Pass the bare `<input>`/`<select>`/`<textarea>` as its child.
