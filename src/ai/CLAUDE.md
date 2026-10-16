# AI notes

Rules for AI features (decision: "AI drafts data, never images" in `docs/decisions.md`). The code arrives with the "AI foundation" ticket.

- `client.ts` is the only importer of `@anthropic-ai/sdk`, the same rule as vis-timeline and maplibre-gl. It reads Bob's key from the device (never saved in the doc or backups) and says clearly when offline or when no key is set.
- One folder per feature: `prompt.md` (version line on top), a tool schema built from `model/types.ts`, `validate.ts` (pure, unit-tested), and `toDraft.ts`. The model answers through a tool or structured output into existing types, never free text into the doc.
- Facts before generation: fetch Wikidata, Pleiades or OWID first and pass the facts in. The model organizes and cites them. Coordinates come from gazetteers, never from the model.
- Validators check the schema (via `parseDoc`), dates (via `dates.ts`), geometry (closed rings, no self-intersection, inside the expected area) and that every claim has a source.
- Drafts are shown on the map as a dashed draft layer and reach the doc only when Bob accepts each record, through `upsert`. AI-drafted records keep their provenance (model, prompt version).
- Tests replay recordings from `tests/ai-evals/<feature>/recordings/` with the network mocked; only `npm run eval:ai` calls the live API (see the `ai-eval` skill).
- No generated images, ever. Text the model writes is never stored as a note.
