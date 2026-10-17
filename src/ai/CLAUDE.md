# AI notes

Rules for AI features (decisions: "AI drafts data, never images" and "AI foundation" in `docs/decisions.md`).

Layout: `client.ts` (the tool loop, errors in Bob's words), `key.ts` (the key in localStorage), `draft.ts` (`DraftSet`, accept helpers, prompt version), and one folder per feature, e.g. `entries/` (`prompt.md`, `tools.ts`, `validate.ts`, `toDraft.ts`, `index.ts`, tests). The review UI is `ui/panels/DraftReview.tsx`, lazy-loaded.

- `client.ts` is the only importer of `@anthropic-ai/sdk`, the same rule as vis-timeline and maplibre-gl. It reads Bob's key from the device (never saved in the doc or backups) and says clearly when offline or when no key is set.
- One folder per feature: `prompt.md` (version line on top), a tool schema built from `model/types.ts`, `validate.ts` (pure, unit-tested), and `toDraft.ts`. The model answers through a tool or structured output into existing types, never free text into the doc.
- Strict tools: make every property `required` and use `""` (or an empty list) for "none". Claude writes a strict tool's fields in schema order, so an optional field it has already passed can't be filled in: it ends up in another field's text, or the answer runs to the token limit (seen in `highlight@1`).
- Facts before generation: fetch Wikidata, Pleiades or OWID first and pass the facts in. The model organizes and cites them. Coordinates come from gazetteers, never from the model.
- Validators check the schema (via `parseDoc`), dates (via `dates.ts`), geometry (closed rings, no self-intersection, inside the expected area) and that every claim has a source.
- Drafts are shown on the map as a dashed draft layer and reach the doc only when Bob accepts each record, through `upsert`. AI-drafted records keep their provenance (model, prompt version).
- Tests replay recordings from `tests/ai-evals/<feature>/recordings/` with the network mocked; only `npm run eval:ai` calls the live API (see the `ai-eval` skill).
- No generated images, ever. Text the model writes is never stored as a note.
