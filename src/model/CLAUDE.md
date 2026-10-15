# Model notes

## Dates
Years are astronomical (1 BCE = 0, 431 BCE = -430). Only `dates.ts` converts, including `fromWikidataTime`. Use `toJsDate`, never `new Date(y, …)`. Any date change needs unit tests for BCE, years 0–99 and leap days.

## Mutations
`upsert` / `remove` in `doc.ts` stamp `updatedAt` and record tombstones, which `mergeDocs` depends on. `remove` cascades gently: it drops connections, unlinks notes and territories, and drops excerpts and territory values. It never deletes Bob's notes.

## Schema change checklist
1. Bump `SCHEMA_VERSION` in `types.ts`.
2. Add a `migrateNtoN+1` step in `parseDoc`.
3. Save the previous fixture as `tests/fixtures/sample-history-vN.json` and test that it imports.
4. Update `tests/fixtures/sample-history.json` and `docs/data-model.md` (including its version history).
