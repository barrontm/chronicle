# Roadmap

Chronicle is being redesigned around reading: Bob highlights what he reads, and the app draws it (`docs/vision.md`). Phases are ordered and each one ships something usable. Tick items as they land, and record decisions in `docs/decisions.md`.

## How tickets work
One ticket per session, on its own branch: start fresh, finish with a commit, tick it below. Each ticket says which manual section changes (`docs/manual.md`). Size: S ≈ one sitting, M ≈ a longer one. Model: what to run it on (`/model …`).

Redesign tickets also name **Looks like:** (the prototype or sheet Bob chose: the visual target) and **Representation:** (the module in `src/ui/representations/` it touches). New UI hides behind the "Try the new layout" setting (`ui.next`) until its phase is done.

AI tickets (🤖, see the decision "AI drafts data, never images") also name a **Prompt** (`src/ai/<feature>/prompt.md`), **Cases** (`tests/ai-evals/<feature>/`) and a **Bar** (the score a live run must reach, checked with the `ai-eval` skill). Prompt tuning runs in its own short sessions (sonnet or haiku) that touch only the prompt, its cases and its recordings.

## Ideas inbox
Drop ideas here any time, one line each. Nothing here is promised; each phase checkpoint turns some into tickets.
- 

Triaged 2026-10-17: history of ideas and schools → Phase 5c; influences between dimensions → v6 fields, Phase 2 suggestions, Phase 4 view; distribution of goods → Phase 5b.

## Redesign phases
Each phase ends with a **checkpoint** session (sonnet): triage the inbox, reorder or split the remaining phases, log changes in `docs/decisions.md`, and update `docs/vision.md` if the direction moved.

### Phase 0 — Design and spikes (no app code on `main`)
1. ✅ **Plan into the repo** · S · sonnet. `docs/vision.md`, `docs/references.md`, the design language draft in `docs/design.md`, the `design-critic` agent, this roadmap.
2. ✅ **Prototypes: overview and reader** · M · opus. Two Artifacts on fixture data, each in light, dark and phone: (a) era overview → zoom into an era's six dimension lanes; (b) the reader with a highlight becoming a capture card, on desktop and phone. Offer A/B variants where the direction is open. Bob picks and comments; record the choices in `docs/design.md`.
   Done when: Bob has chosen a direction for both and the *proposed* items they settle are rules in `design.md`.
3. ✅ **Prototypes: polity, economy, war** · M · opus. Three Artifacts: (c) a war animating on the map (routes draw in, battles pulse); (d) Athens' power-structure diagram morphing through its regimes, plus Athens vs Sparta in 431 BCE; (e) Athens' economy portrait (treemap) and sector streamgraph, with Black Sea grain flowing to Piraeus.
   Done when: Bob has chosen a direction for each.
4. ✅ **Spikes** · M · opus to brief, three background sonnet agents in worktrees. (a) A custom timeline renderer with 2,000 items and the three zoom levels; (b) the reader: Parsoid HTML, DOMPurify, highlight anchoring that survives a revision, on phone and desktop; (c) border morph (flubber) and progressive route drawing on MapLibre. Each returns a short report, its numbers and a demo; nothing is merged.
   Done when: decisions on the renderer, the reader and the animation approach are in `docs/decisions.md`.
5. ✅ **Rich fixture and gallery** · M · sonnet. A Classical Greece fixture (test data only, about 150 entries: eras, themes, highlights, territories, a war, a migration, Athens' and Sparta's regimes, an Athenian economy) built with the `draft-map-data` skill; a dev-only `/#gallery` route; `npm run shots -- --filmstrip <view>` and `--video`.
   Done when: the gallery shows the existing representations from the fixture and a filmstrip of the map playing 480→400 BCE renders as one image.

### Phase 1 — Reader
Reader pane on laptop and phone; highlights saved (schema v6, `Excerpt` migrates into a highlight; connections also gain an optional `effect` and `highlightIds` as evidence, for Phase 4's influences); subject recognition from Wikidata (`src/model/subjects.ts`); offline article cache. Under `ui.next`, the Add button and kind buttons give way to "Open an article". Turning highlights into records is Phase 2; until then the tray can add the article's own subject through today's Wikipedia prefill. Spike code to port is on `spike/reader` (`spikes/reader/`), report in `docs/spikes/reader.md`.

**Status:** tickets 1–2 done on `ticket/reader-shell` and `ticket/reader-articles` (stacked on `ticket/phase0-checkpoint`). Next: ticket 3 on `ticket/schema-v6`, branched from `ticket/reader-articles`. Tickets stack until Bob releases them. Follow-up: the infobox fills the top of the reader; consider folding it.

1. ✅ **New layout shell and "Open an article"** · M · opusplan. Looks like: the reader prototype (`docs/design.md`, Reader and capture). Representation: none. A "Try the new layout" setting (`ui.next`, `useStored`). Under it the laptop shows a reader column (text about 34em) beside the map over a timeline strip, with "Open an article" and a reading trail in the top bar; the phone shows the reader full screen, and "Map" opens map and timeline as a sheet. "Open an article" reuses `searchWikipedia`. With the setting off nothing changes.
   Files: `src/ui/App.tsx`, `src/ui/styles.css`, new `src/ui/reader/ReaderPane.tsx`.
   Done when: an e2e test turns the setting on, searches, opens an article (mocked) and sees its title in the reader, on desktop and phone. Manual: a new "Try the new layout" section.
2. ✅ **Articles: fetch, clean, cache** · M · opus. `src/media/article.ts`: `/w/rest.php/v1/page/{title}/html`, revision id from the `about` attribute, fetches one at a time (Wikipedia returns 429s at about 3 a second). The spike's allowlist sanitizer becomes `src/media/sanitize.ts` with its hostile-input tests. Cleaned articles are cached in IndexedDB outside the doc (`{key, title, revisionId, modified, pageId, fetchedAt, html}`); thumbnails are rewritten for the service worker's Commons cache. Wiki links open in the reader and build the reading trail (back and forward). Offline, cached articles open and others say they need a connection.
   Files: `src/media/article.ts`, `src/media/sanitize.ts`, `src/data/articleCache.ts`, `ReaderPane.tsx`.
   Done when: an e2e test (network mocked) opens an article, follows a link, goes back, and rereads it offline. Manual: Reading articles.
3. **Schema v6** · M · opusplan. `Highlight { id, sourceId, text, anchor: { revisionId, section, exact, prefix, suffix, pos? }, dimension?, subjectQid?, usedBy, updatedAt }`; `Dimension` (political, economic, social, technological, intellectual, religious); `dimension?` on entries; `themes` on periods; `effect?` and `highlightIds?` on connections. Each entry's `excerpt` migrates into a highlight.
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts` (upsert, remove, merge), the upgrade test.
   Done when: v5 backups import with excerpts as highlights, merge handles highlights, and the existing excerpt display reads from them. Manual: Highlights.
4. **Highlighting in the reader** · M · opus. Looks like: the reader prototype. `src/model/anchor.ts` (pure, ported from the spike with its revision tests): a text model without footnote markers, exact in section → exact in article → fuzzy (`approx-string-match`), and an `uncertain` flag. Select, then "Highlight" (H on the laptop, docked at the bottom on the phone); on the phone a tap highlights a sentence (`Intl.Segmenter` plus an abbreviation merge). Marks use the CSS Custom Highlight API (32% open, 13% kept, 20% plus underline added) with a description for screen readers. A highlight is saved the moment it's made.
   Before building: try the spike demo on a real iPhone and Android phone (`docs/spikes/reader.md`, Risks).
   Done when: an e2e test highlights a passage, reloads, and sees it marked; unit tests re-anchor across a revision. Manual: Highlighting.
5. **Subject recognition** · M · opusplan. `src/model/subjects.ts` (pure, tested on recorded Wikidata JSON): QID → P31/P279 chain → `person | polity | period | war | battle | event | movement/idea | technology | economy | work | place | migration`, with facts (P580/P582/P585, P625, P361, P155/P156, P710, P276, P122). The fetch goes in `src/media/wikipedia.ts`. The reader header shows what the article is and "Already in Chronicle" (by `wikidataId`).
   Done when: unit tests classify the Greece fixture's subjects (Pericles, Peloponnesian War, Battle of Salamis, Athens, Delian League) and the header shows them in an e2e test. Manual: Reading articles.
6. **Capture tray** · M · opus. Looks like: the reader prototype's tray. It slides up under the text, which scrolls so the passage stays above it. It shows the quote and section, what the article is (glyph, kind, title, or "Already in Chronicle"), its facts, and a dimension picker. Actions: "Just keep the highlight", Remove, and "Add to map and timeline" for the article's own subject through `draftFromWikipedia`. Moving on keeps an undecided highlight. Highlights are listed per source in the Library and on an entry's panel.
   Done when: an e2e test highlights, picks a dimension, keeps it, adds the article's subject, and sees the highlight on the entry's panel; the design-review sheet matches the prototype. Manual: Highlighting.
7. **Phase 1 checkpoint** · S · sonnet. Triage the inbox, write the Phase 2 tickets, log decisions.

### Phase 2 — Highlight → record
Code path (dates, places and links from Wikidata facts); 🤖 `highlight` feature (claims and a dimension from a highlight, article prompt-cached; when a passage states a cause, such as "the war drained the treasury", it also suggests a connection with an effect, citing that highlight); review reusing `DraftReview`.

### Phase 3 — New timeline
Custom renderer at parity with today's timeline, then levels 0 and 1; vis-timeline removed; `ui.next` becomes the default.

### Phase 4 — Eras, themes and influences
Era bands with theme chips; 🤖 `themes` feature (groups an era's highlights with a suggested label Bob accepts or edits); influences between dimensions (the war on the economy, Christianity on politics, technology on the economy, capitalism on who holds power).

Connection endpoints grow with the schema: each bump that adds a record (v6 themes, v7 regimes, v8 economies, v9 institutions) also makes it something a connection can point at, so nothing gets renumbered.
1. **Prototype: influences across dimensions** · M · opus. An Artifact on fixture data at level 1 (an era's six dimension lanes), in light, dark and phone. A: arrows between items in different lanes, labelled with the effect, with the highlight one tap away. B: an era's "what drove what" grid (six dimensions by six, each cell counting Bob's links) that opens into A. Fixture cases: the Peloponnesian War weakening Athens' economy (Decelea, the Laurion mines), the plague and religion, Delian League tribute paying for the building program. Add any shapes the schema lacks to `tests/fixtures/greece/next.json`.
   Done when: Bob has picked, and the effect vocabulary (caused, enabled, weakened, strengthened, funded, legitimised, …) and the arrow style are rules in `docs/design.md`.
2. **Influences between dimensions** · M · opusplan. Looks like: ticket 1's pick. Representation: new `src/ui/representations/influence.ts`. The connection editor gets an effect (open vocabulary, edited in the app) and "Evidence" (pick highlights). Level 1 draws connections whose two ends are in different dimensions. An entry's panel lists "Effects on other dimensions" both ways ("Weakened: Athenian economy", "Weakened by: Peloponnesian War").
   Files: `src/model/doc.ts` (a cross-dimension query, tested), the connection editor in `src/ui/panels/ItemPanels.tsx`, the renderer's level 1.
   Done when: an e2e test links the war to the economy as "weakened" with a highlight, and sees the arrow cross lanes at level 1 and the line in both panels. Manual: Connections.

### Phase 5 — Polities and wars
Regimes and the power-structure diagram (schema v7, with alliances); regime-styled territories; border morph; campaigns and battles. Folds in paused tickets 3–6, 18 and 20. Build the power-structure diagram from roles and links in general, not polity ones only, because Phase 5c reuses it for schools.

### Phase 5b — Economy
`EconomyProfile` and goods flows (schema v8); sector streamgraph; production sites; economy portrait; 🤖 sector claims from highlights. Alongside what was produced, it also records **how goods reached people**.
1. **Prototype: how goods were distributed** · S · opus. Adds to prototype (e), the economy portrait. Each snapshot gets a distribution band with relative shares of the mechanisms: kinship and gift, redistribution (palace, temple, state), tribute, householding, market exchange, planning. The vocabulary is open, with Polanyi's reciprocity, redistribution and exchange as a starting point. Add a strip that follows the mechanisms across eras: Mycenaean palace redistribution → Archaic households and gift → Classical Athens, where markets in the agora sit beside liturgies and the grain dole.
   Done when: Bob has picked, and the vocabulary and the band's look are in `docs/design.md`.
2. **Distribution in economy profiles** · M · opusplan. Part of the v8 bump, not a bump of its own. `snapshots[].distribution: { mechanism, share?: { measure: 'relative', low?, high? }, institutions?, highlightIds }[]`, where an unknown share stays unknown. Representation: the economy module (band in the portrait, a thin mechanism strip under the sector streamgraph). The 🤖 sector claims also suggest mechanisms.
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts` (merge), the economy representation.
   Done when: the fixture's Athens shows markets and liturgies in 431 BCE, the band changes between snapshots, and v7 backups import. Manual: Economies.

### Phase 5c — Ideas, schools and spread
Technology and idea spread waves; influence arcs; the tech tree (paused ticket 10). Then a history of ideas: where a work or idea was known, lost and revived, how it travelled, and the schools that taught it (schema v9). Bob can still keep a "History of ideas" category for his own topic. This adds a representation, not a kind.
1. **Prototype: history of ideas** · M · opus. Two Artifacts on fixture data, in light, dark and phone. (f) Aristotle's reception: a thread per region on the timeline that thins where his works were lost and brightens where they came back, plus arrows on the map for the translations (Athens → Alexandria → Baghdad's translation movement → Toledo and Sicily → Paris). (g) Plato's Academy against the University of Paris around 1250, shown with the power-structure diagram: who teaches, who learns, who pays, who licenses, the curriculum, and the ties to the city, the church and the crown. The fixture gets a small medieval appendix (test data only).
   Done when: Bob has picked both, and `docs/decisions.md` records whether institutions are a subject type of their own that shares the regime diagram.
2. **Schools and institutions** · M · opusplan. Looks like: (g). v9. An `institution` row in `src/model/subjects.ts` (Wikidata: school, university, academy, madrasa, monastery). `structures` snapshots have the same shape as regimes (roles and links, with link kinds as an open vocabulary: teaches, funds, licenses, governs, examines), plus a curriculum list and `highlightIds`. Representation: new `src/ui/representations/institution.ts` (lifespan bar split by structure, map pin, the diagram morphing between snapshots, two institutions side by side).
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts`, the shared diagram from Phase 5.
   Done when: an e2e test compares the Academy and the University of Paris side by side, and v8 backups import. Manual: Schools and institutions.
3. **Reception and transmission of ideas** · M · opusplan. Looks like: (f). Shares ticket 2's v9 bump, and the two land in the same release. `reception: { where (place, territory or country), from, to?, state: 'known' | 'partial' | 'lost' | 'revived' | 'taught', via?, highlightIds }[]` on idea and work entries. `Flow.subject` gains `'ideas'` for translations and teachers moving, drawn without a rate. A school that teaches a work links to it. Representation: new `src/ui/representations/idea.ts` (reception threads on the timeline, regions tinted by state on the map, transmission arrows).
   Files: as ticket 2, plus `src/ui/mapData.ts` (state by year, tested).
   Done when: an e2e test sees Aristotle "lost" in the Latin West in 900, "revived" in 1200, and the Toledo → Paris arrow. Manual: History of ideas.

### Phase 6 — Other sources
A Cloudflare Worker proxy with Readability for sites without CORS; a bookmarklet and PWA share target ("send to Chronicle").

## Paused tickets (folded into the redesign)
Paused on 2026-10-16. Each is rewritten as a redesign ticket when its phase comes up: 2–6, 18 and 20 → Phase 5; 7 (Meanwhile) and 9 (Search) → the reader and level 2; 8 (Review mode) → after Phase 4, quizzing from highlights; 10 → Phase 5c; 11 → any time; 13, 14, 19 → Phase 5b or later; 16 → the Phase 0 fixture.

1. ✅ **Place picker** · S · sonnet. Set an entry's places by hand (name plus coordinates; "Look up" via Wikidata search is a bonus), so hand-made entries get map pins. 🏛 Battles need this to appear on the map.
   Files: `src/ui/panels/ItemPanels.tsx` (places section in `ItemEditor`), `src/media/wikipedia.ts` (coordinate lookup). Could also offer "Pick on the map", reusing `nav.draw`'s pattern.
   Done when: add, edit and remove places in the editor; an e2e test adds a place and sees the pin label on the map.
2. 🏛 **Detailed Aegean coast** · S · sonnet. Bundle a Natural Earth 10m land and coastline layer clipped to the Mediterranean (about lon −10…45, lat 28…48), shown from zoom 5, and raise `maxZoom` to 12.
   Files: `scripts/build-geo.ts`, `src/ui/MapView.tsx`, precache list.
   Done when: Aegina and Salamis are recognizable at zoom 9 and the size change is noted in `docs/decisions.md`.
3. 🏛 **Edit borders over time** · M · opus. Drag, add and delete the vertices of an existing snapshot; "Copy to new dates" (Athens after 338 BCE from Athens before). Show a pending drawn shape on the map while its form is open.
   Files: `src/ui/drawing.ts` (edit operations, tested), `MapView.tsx` (vertex dragging), `TerritoryEditor` in `src/ui/panels/TerritoryPanels.tsx`.
   Done when: an e2e test copies a snapshot, moves one vertex and sees the new area.
4. 🏛 **Alliances** · M · opusplan. Schema v6 (v5 went to AI provenance). `Alliance { id, title, color, itemId?, members: { territoryId, from, to? }[], updatedAt }`, plus a map option "Color by alliance" that tints members by bloc for the current year, with a legend.
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
12. ✅ **Migration flows on the map** · M · opusplan. Schema bump. Curved arrows between places: width = people moving per year at the current year, color = cause, and dashes that move from origin to destination at a speed set by the rate, so direction and volume read at a glance. `Flow { id, title, categoryId, cause, measure: 'moved' | 'living', itemId?, routes: { from: FlowEnd, to: FlowEnd, points: SeriesPoint[] }[], source?, note?, updatedAt }`. `FlowEnd` is a country code, a territory id, or a named point (lon/lat), so Bob can record ancient and early-modern migrations by hand (Greek colonies, the Irish famine, the Great Migration), with estimated numbers, dates, a cause, a source, and the entry it belongs to. Causes: conflict & persecution, work & economy, famine & disaster, forced (slavery, deportation), colonization & settlement, family & other, unknown. `measure` keeps flows (people moving per year: moving dashes) apart from stocks (people living abroad: still arrows, labeled so), so the map never passes one off as the other. Hover: "Ireland → United States · famine & disaster · about 130,000 a year (1846–1855)". The map's layers menu gets "Migration" with a filter by cause and a legend; an entry's panel lists its flows and "Show on map".
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts` (upsert, remove, merge), flow geometry and the per-year rate in `src/ui/mapData.ts` (great-circle arcs, tested), `MapView.tsx` (arrow layers, animated dashes), a new `FlowEditor` panel (pick ends by country, territory, or a click on the map, reusing `nav.draw`'s pattern).
   Done when: an e2e test records Ireland → United States (famine, 1846–1855), sees the arrow in 1850 and not in 1870, and old backups still import.
13. **Migration data: refugees by cause, flows since 1990** · M · opus. Two imports that make `Flow`s (ticket 12) for one country at a time, both offered in Find a trend:
   - **Refugees (UNHCR):** `api.unhcr.org/population/v1/population/` (CORS open, live, yearly since 1951), origin → country of asylum. "Refugees from Syria by country of asylum" or "Refugees living in Germany by origin". Cause is conflict & persecution; measure is `living` (refugees there that year), with an option for the yearly change as an approximate flow.
   - **All migration (Abel & Cohen, CC BY):** five-year bilateral flow estimates for 200 countries, 1990–2020, by sex (figshare). It's a 21 MB CSV, so `scripts/build-migration-flows.ts` splits it into `public/data/flows/<ISO3>.json` (fetched on demand, runtime-cached, not precached). Shown as people per year (each period's total ÷ 5), with cause "unknown (all reasons)"; the legend says these are model estimates.
   - Only the biggest routes are drawn by default (top 15 by volume, with a slider), so the map stays readable.
   Files: `scripts/build-migration-flows.ts`, `scripts/build-trend-index.ts` (catalogue entries), `src/data/flows.ts` (parsers, tested with fixtures), Find a trend in `SeriesEditor.tsx` / `TrendSearch.tsx`.
   Done when: mocked e2e tests import refugees from Syria and see the arrow to Turkey, and import flows from Mexico and see the arrow to the United States, each with its cause in the legend.
14. **Bubbles for counts, click a country for its curve** · M · opus. Totals (people, $) become circles at country centroids (`labelPoint` over the bundled countries), area ∝ value, scaled to the maximum over all years so growth shows as the year plays; rates keep shading. `defaultMapStyle(series)` guesses from the unit; a "Show as: Shades / Bubbles" toggle (per trend, `useStored`) overrides. The legend gets reference circles. Clicking a country opens a sparkline with the current year marked.
   Files: `src/ui/mapData.ts` (`countryBubbles`, `defaultMapStyle`, tested), `MapView.tsx` (bubbles layer, popover), `MapPane.tsx` (toggle, legend).
   Done when: an e2e test switches a population trend to bubbles and sees the bubble legend.
15. ✅ **Time navigation** · M · opus. The wheel moves through time (Shift scrolls lanes, Ctrl/⌘ or pinch zooms); a thumbwheel and a zoom bar with Year/Decade/Century/Millennium/All stops under the timeline. Clicking an entry zooms to its time with its connections in view, with "Back to where I was"; every connection lights up, not only influences. The entry panel's Bibliography gathers sources cited by it, its notes and its connections, and works by a person.
   Files: `src/ui/timeNav.ts` (tested), `src/ui/TimeBar.tsx`, `TimelineView.tsx`, `bibliographyFor` in `src/model/doc.ts` (tested), `ItemView`.
   Done when: an e2e test zooms with a stop, scrolls with the wheel and thumbwheel, clicks Plato and sees his time, his works and the way back.
16. 🤖 **Draft map data with Claude Code** · S · sonnet. Stage 0: no app change. Skill and checker are in place; what remains is a first real draft. The `draft-map-data` skill drafts an import file from Wikidata and Pleiades with real citations; `scripts/check-draft.mjs` runs `parseDoc` and warns about unsourced records and places outside the area; Bob loads it with Import → Merge.
   Done when: a draft of the Delian League's founding members imports cleanly and shows on the map.
17. ✅ 🤖 **AI foundation** · M · opusplan. `@anthropic-ai/sdk` behind `src/ai/client.ts` (rules in `src/ai/CLAUDE.md`); a key setting kept on the device and out of backups, with clear offline and no-key states; provenance on drafted records (schema bump, shared with ticket 4's v5 if it lands first); a review panel that shows drafts as a dashed layer and accepts or rejects each record; `npm run eval:ai` on Promptfoo with a committed baseline, and recordings replayed in tests.
   Files: `src/ai/`, `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, a new `DraftReview` panel, `MapView.tsx` (draft layer), `scripts/eval-ai.mjs`, `tests/ai-evals/`.
   Done when: a mocked e2e test asks for a draft, sees it dashed on the map, accepts one record and rejects another; `eval:ai` runs one case live; old backups still import. Manual: a new "Drafting with AI" section.
18. 🤖 🏛 **Draft a polis's borders** · M · sonnet. From Pleiades sites and the text Bob gives, draft a `TerritorySnapshot` (rough hull around a polis's known sites, clipped to land) for the years he names. Pairs well after ticket 3, so drafts are easy to fix.
   Prompt: `src/ai/territory/prompt.md`. Cases: Athens, Sparta, Corinth, Thebes around 431 BCE. Bar: every case passes validation and contains its known sites.
   Done when: the case set meets the bar and a mocked e2e test drafts Corinth and sees it on the map.
19. 🤖 **Draft migration flows** · S · sonnet. Turn a described migration ("Greek colonies in Sicily, 8th century BCE") into a `Flow` with cause, measure, ends from Pleiades or countries, and sourced estimates; unknown numbers stay unknown, never invented.
   Prompt: `src/ai/flows/prompt.md`. Cases: Greek colonization of Sicily, the Irish famine, the Great Migration. Bar: causes and directions all right, every number sourced.
   Done when: the cases meet the bar and a mocked e2e test drafts one flow.
20. 🤖 🏛 **Draft alliance members and campaign routes** · M · sonnet. After tickets 4 and 5: membership by year from Wikidata (P463) and cited sources; a campaign's route through Pleiades places in order.
   Cases: the Delian League in 454 and 404 BCE, Xerxes' march in 480 BCE. Bar: members right in each test year, route starts and ends at the right places.
   Done when: both case sets meet the bar.

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
- [x] Place picker in the entry editor: look up on Wikipedia, pick on the map, or type coordinates

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
