# Roadmap

Chronicle is being redesigned around reading: Bob highlights what he reads, and the app draws it (`docs/vision.md`). Phases are ordered and each one ships something usable. Tick items as they land, and record decisions in `docs/decisions.md`.

## How tickets work
One ticket per session, on its own branch: start fresh, finish with a commit, tick it below. Each ticket says which manual section changes (`docs/manual.md`). Size: S ≈ one sitting, M ≈ a longer one. Model: what to run it on (`/model …`).

Redesign tickets also name **Looks like:** (the prototype or sheet Bob chose: the visual target) and **Representation:** (the module in `src/ui/representations/` it touches). New UI hides behind the "Try the new layout" setting (`ui.next`) until its phase is done.

AI tickets (🤖, see the decision "AI drafts data, never images") also name a **Prompt** (`src/ai/<feature>/prompt.md`), **Cases** (`tests/ai-evals/<feature>/`) and a **Bar** (the score a live run must reach, checked with the `ai-eval` skill). Prompt tuning runs in its own short sessions (sonnet or haiku) that touch only the prompt, its cases and its recordings.

## Ideas inbox
Drop ideas here any time, one line each. Nothing here is promised; each phase checkpoint turns some into tickets.
- Every kind of thing drawn on both the map and the timeline, polities and ideas included, and addable from the tray once drawn (decided 2026-10-17; see `docs/decisions.md`; gaps: works, places, events, battles).

Triaged 2026-10-17: history of ideas and schools → Phase 5c; influences between dimensions → v6 fields, Phase 2 suggestions, Phase 4 view; distribution of goods → Phase 5b.

Triaged 2026-10-17 (later): talking with Socrates → Phase 2b; kinds of border, war technology, disasters, discoveries, the look of ideas and religion → Phase 5d; PDFs and EPUBs → Phase 6.

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

**Status:** done. Tickets 1–6 are released on `main`; the checkpoint (ticket 7) wrote Phase 2. The infobox follow-up is Phase 2 ticket 2.

1. ✅ **New layout shell and "Open an article"** · M · opusplan. Looks like: the reader prototype (`docs/design.md`, Reader and capture). Representation: none. A "Try the new layout" setting (`ui.next`, `useStored`). Under it the laptop shows a reader column (text about 34em) beside the map over a timeline strip, with "Open an article" and a reading trail in the top bar; the phone shows the reader full screen, and "Map" opens map and timeline as a sheet. "Open an article" reuses `searchWikipedia`. With the setting off nothing changes.
   Files: `src/ui/App.tsx`, `src/ui/styles.css`, new `src/ui/reader/ReaderPane.tsx`.
   Done when: an e2e test turns the setting on, searches, opens an article (mocked) and sees its title in the reader, on desktop and phone. Manual: a new "Try the new layout" section.
2. ✅ **Articles: fetch, clean, cache** · M · opus. `src/media/article.ts`: `/w/rest.php/v1/page/{title}/html`, revision id from the `about` attribute, fetches one at a time (Wikipedia returns 429s at about 3 a second). The spike's allowlist sanitizer becomes `src/media/sanitize.ts` with its hostile-input tests. Cleaned articles are cached in IndexedDB outside the doc (`{key, title, revisionId, modified, pageId, fetchedAt, html}`); thumbnails are rewritten for the service worker's Commons cache. Wiki links open in the reader and build the reading trail (back and forward). Offline, cached articles open and others say they need a connection.
   Files: `src/media/article.ts`, `src/media/sanitize.ts`, `src/data/articleCache.ts`, `ReaderPane.tsx`.
   Done when: an e2e test (network mocked) opens an article, follows a link, goes back, and rereads it offline. Manual: Reading articles.
3. ✅ **Schema v6** · M · opusplan. `Highlight { id, sourceId, text, anchor: { revisionId, section, exact, prefix, suffix, pos? }, dimension?, subjectQid?, usedBy, updatedAt }`; `Dimension` (political, economic, social, technological, intellectual, religious); `dimension?` on entries; `themes` on periods; `effect?` and `highlightIds?` on connections. Each entry's `excerpt` migrates into a highlight.
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts` (upsert, remove, merge), the upgrade test.
   Done when: v5 backups import with excerpts as highlights, merge handles highlights, and the existing excerpt display reads from them. Manual: Highlights.
4. ✅ **Highlighting in the reader** · M · opus. Looks like: the reader prototype. `src/model/anchor.ts` (pure, ported from the spike with its revision tests): a text model without footnote markers, exact in section → exact in article → fuzzy (`approx-string-match`), and an `uncertain` flag. Select, then "Highlight" (H on the laptop, docked at the bottom on the phone); on the phone a tap highlights a sentence (`Intl.Segmenter` plus an abbreviation merge). Marks use the CSS Custom Highlight API (32% open, 13% kept, 20% plus underline added) with a description for screen readers. A highlight is saved the moment it's made.
   Phone check (2026-10-17, Bob's iPhone in Safari, spike demo): selecting, dragging the handles, the docked Highlight button, tap-a-sentence and extending to the next sentence all work; a double-tap highlights the sentence and doesn't zoom. The reader needs no double-tap zoom: use `touch-action: manipulation` on the text, but keep pinch zoom for accessibility. Android and Firefox can't be checked on a real device (Bob has neither): keep the docked button clear of Android's selection toolbar, and test in Playwright's Firefox.
   Done when: an e2e test highlights a passage, reloads, and sees it marked; unit tests re-anchor across a revision. Manual: Highlighting.
   Done (2026-10-17): the matcher is pure in `src/model/anchor.ts` and `sentences.ts`; the DOM text model is `src/ui/reader/textModel.ts`. Re-anchoring 200 random passages on recorded pages: 97.5% placed six months on (Peloponnesian War), 91% two years on (Pericles). The e2e test also passed once in Playwright's Firefox, desktop WebKit and iPhone WebKit. Until the tray (ticket 6), "Remove highlight" sits where the Highlight button does. A tap next to a link follows the link (the browser's touch adjustment), not tap-a-sentence.
5. ✅ **Subject recognition** · M · opusplan. `src/model/subjects.ts` (pure, tested on recorded Wikidata JSON): QID → P31/P279 chain → `person | polity | period | war | battle | event | movement/idea | technology | economy | work | place | migration`, with facts (P580/P582/P585, P625, P361, P155/P156, P710, P276, P122). The fetch goes in `src/media/wikipedia.ts`. The reader header shows what the article is and "Already in Chronicle" (by `wikidataId`).
   Done when: unit tests classify the Greece fixture's subjects (Pericles, Peloponnesian War, Battle of Salamis, Athens, Delian League) and the header shows them in an e2e test. Manual: Reading articles.
   Done (2026-10-17): 14 recorded subjects in `tests/fixtures/subjects/` (re-record with `node scripts/record-subjects.mjs <keys>`) all classify right. "Athens" (today's city) is a place and "Classical Athens" a polity; the Delian League is a polity until alliances get their own kind. The header shows kind · dates · part of, and "Already in Chronicle" (entries and territories, by `wikidataId`) opens the record. Subjects are cached beside articles, so the line shows offline. The Greece fixture's entries have no Wikidata ids yet.
6. ✅ **Capture tray** · M · opus. Looks like: the reader prototype's tray. It slides up under the text, which scrolls so the passage stays above it. It shows the quote and section, what the article is (glyph, kind, title, or "Already in Chronicle"), its facts, and a dimension picker. Actions: "Just keep the highlight", Remove, and "Add to map and timeline" for the article's own subject through `draftFromWikipedia`. Moving on keeps an undecided highlight. Highlights are listed per source in the Library and on an entry's panel.
   Done when: an e2e test highlights, picks a dimension, keeps it, adds the article's subject, and sees the highlight on the entry's panel; the design-review sheet matches the prototype. Manual: Highlighting.
   Done (2026-10-17): `src/ui/reader/CaptureTray.tsx`, with facts from `subjectFacts` in `src/model/subjects.ts`. "Add" opens today's entry editor, prefilled by `draftFromWikipedia`, with Bob's highlight as the quote and the article he read as the cited source (no second copy). When the subject is already in Chronicle, "Link to …" adds the highlight to it at once. Library has a Highlights tab, grouped by source. On the phone the new entry's sheet covers the tray until it's closed. Glyphs for period, idea, technology, economy, work and migration are stand-ins (`docs/design.md`).
7. ✅ **Phase 1 checkpoint** · S · sonnet. Triage the inbox, write the Phase 2 tickets, log decisions.
   Done (2026-10-17): the inbox was empty. Phase 2 is six tickets plus its checkpoint; see "Phase 1 checkpoint" in `docs/decisions.md`.

### Phase 2 — Highlight → record
Code path (dates, places and links from Wikidata facts); 🤖 `highlight` feature (claims and a dimension from a highlight, article prompt-cached; when a passage states a cause, such as "the war drained the treasury", it also suggests a connection with an effect, citing that highlight); review reusing `DraftReview`.

A highlight can become three things, cheapest first: **the article's subject** (works today), **a subject linked in the passage** (the passage's wiki links, classified by `subjects.ts`: code, no AI), or **something with no article of its own** (Pericles elected general in 443 BCE, tribute paying for the Parthenon), which only the 🤖 `highlight` feature can draft. Claude is asked on demand from the tray, never on every highlight. Everything still lands through `upsert` once Bob accepts it, and the highlight's `usedBy` (and a connection's `highlightIds`) record what it became.

1. ✅ **Prototype: from highlight to record** · S · opus. Adds to the reader prototype's tray (`docs/design.md`, Reader and capture). (a) "Becomes" with several candidates: the article's subject plus the subjects linked in the passage, one chosen, each with glyph, kind and "Already in Chronicle". (b) After "Ask Claude": the suggested dimension marked in the picker, drafted records (a new event with its date and place, a connection labelled with its effect) to accept or reject one by one, and the dashed draft on the map. (c) The folded infobox. Desktop and phone, light and dark, on fixture data. Offer A/B for where the drafted records sit: inside the tray, or in today's `DraftReview` panel opened from it.
   Done when: Bob has picked, and the choices are rules in `docs/design.md`.
   Done (2026-10-17): `docs/prototypes/capture.html`. Bob chose A (drafts in the tray), the first choice in "Becomes" (the first event, war or battle linked, else the article's subject), and the infobox as drawn.
2. ✅ **Fold the infobox** · S · sonnet. Looks like: ticket 1 (c). Representation: none. Under `ui.next` the article's infobox starts folded to one line (its picture as a small thumbnail plus "Infobox"), so the text starts near the top on the phone; tapping opens it, and the choice is remembered per device (`useStored`). Highlighting inside an open infobox still works.
   Files: `ReaderPane.tsx`, `src/ui/styles.css`.
   Done when: an e2e test opens an article with an infobox, sees the first paragraph in view on the phone, unfolds the infobox and sees its rows. Manual: Reading articles.
   Done (2026-10-17): `src/ui/reader/Infobox.tsx` wraps the article's first infobox and portals a header into it; the header carries `data-ui`, which `textModel.ts` skips, so highlights anchor as before. Open, the picture floats beside the label rows (stacked on the phone), rows without a label (a war's two sides) sit side by side, and the infobox's title row is hidden because it repeats the article's. `useStored` moved to `src/ui/useStored.ts`. The reader shots gained `*-reader-infobox`.
3. ✅ **Candidates from the passage** · M · opusplan. Looks like: ticket 1 (a). Representation: none. Pure `src/model/passage.ts`: the wiki links inside or overlapping a highlight (from the text model's offsets) → page titles, de-duplicated, in reading order, with the article's own subject first. Their subjects come from `fetchSubject`, one at a time, cached beside the article so they show offline. The tray's "Becomes" lets Bob choose one; "Add to map and timeline" drafts the chosen page through `draftFromWikipedia` (the highlight as quote, the article he read as the cited source, as today), and "Link to …" works for any candidate already in Chronicle. The chosen candidate's QID is saved as the highlight's `subjectQid` (no schema change: the field's meaning widens from "the article's subject" to "what this highlight is about").
   Files: `src/model/passage.ts` (tested), `src/ui/reader/textModel.ts` (link offsets), `useSubject.ts`, `CaptureTray.tsx`, `src/data/articleCache.ts`.
   Done when: unit tests pick the candidates out of a recorded Pericles passage, and an e2e test (network mocked) highlights a sentence of Pericles that links the Peloponnesian War, picks it, adds it, and sees the highlight on the war's panel. Manual: Highlighting.
   Done (2026-10-17): `src/model/passage.ts` (`passageCandidates`, `firstChoice`; date pages and links back to the article are left out, at most 6 linked pages). The text model notes each `a[data-wiki]`'s span. `useSubjects` looks pages up one at a time through the same subjects store as the article's, so the list shows offline. The tray's "Becomes" is a radio list; the pick is saved as `subjectQid` when Bob picks, links or adds. Places, polities and ideas not in Chronicle say why they can't be added (per `docs/design.md`; until now polities and ideas could be added as entries). The chosen candidate's dashed ghost on the map waits for ticket 6's draft layer. The reader shots now answer Wikidata by title from all the recordings.
4. ✅ **Connections from Wikidata facts** · S · sonnet. Representation: none. Pure `factRelations(subject, doc)` in `src/model/subjects.ts`: when a subject is added or linked, facts that point at records already in Chronicle become suggested connections (P361 part of → part of, P155/P156 follows/followed by → led to, P710 participants and P276 location → related), each citing the highlight in `highlightIds`. They appear in the entry editor beside today's influence suggestions, ticked, and are saved with the entry. Generalises the person-only influence code in `draftFromWikipedia`.
   Files: `src/model/subjects.ts` (tested), `src/media/wikipedia.ts`, the suggestions list in `src/ui/panels/ItemPanels.tsx`.
   Done when: unit tests on the recorded subjects (Battle of Salamis part of the Second Persian invasion; Peloponnesian War participants), and an e2e test adds Salamis with the invasion already in Chronicle and sees the "part of" connection, its highlight as evidence. Manual: Connections.
   Done (2026-10-17): `factRelations(itemId, facts, doc, highlightId?)` in `src/model/subjects.ts` also covers influences (P737 both ways), so `influenceRelations` is gone; at most one suggestion per entry, none to entries already connected. Subjects now read P737 (`influencedBy`, optional, so cached subjects still work). Only entries are matched, not territories, because connections join entries. The editor lists them under "Wikipedia also says", ticked; the reader's Add cites the highlight. "Link to …" in the tray offers the same, ticked, saved on link. An entry's connections show their evidence quote. Checkboxes now take `--ink`.
5. 🤖 **The `highlight` feature** · M · opusplan. Representation: none (UI is ticket 6). `src/ai/highlight/` per `src/ai/CLAUDE.md`. In: the highlight, its section, the article's plain text as a cached system block (`cache_control`), the article's subject and the passage's candidates with their Wikidata facts, and the doc's matching entries (title, dates, `wikidataId`). Out, through one tool: a suggested dimension; draft entries for what has no article (title, kind, dates through `dates.ts`, place names resolved by `lookUpPlace`, never coordinates from the model); and connections with an `effect` between records in Chronicle, candidates or the drafts. Every claim carries the words of the passage it rests on; the validator drops claims whose words aren't in the highlight or its section, dates that `dates.ts` can't parse, and numbers the passage doesn't state. Drafts cite the article and the highlight, and keep provenance.
   Prompt: `src/ai/highlight/prompt.md`. Cases (recorded articles in `tests/ai-evals/highlight/`): Pericles' building programme paid by Delian League tribute (economic; connection "funded"); the Spartans at Decelea and the Laurion mines (economic; "weakened"); the plague of Athens (social, with a religious reading allowed); the treasury moved from Delos to Athens in 454 BCE (political; a dated event); Themistocles' naval law (technological or political; an event in 483–482 BCE). Bar: validation passes on every case, the dimension is right or allowed in at least 4 of 5, every date matches the passage, every connection has an effect and cites its highlight, and no number appears that the passage lacks.
   Files: `src/ai/highlight/`, `src/ai/draft.ts` (a `DraftSet` can carry a suggested dimension and a source highlight), `tests/ai-evals/highlight/`.
   Done when: the cases meet the bar in a live run (`ai-eval` skill), and unit tests replay the recordings through the validator. Manual: none (no UI yet).
6. **Review drafts from the tray** · M · opus. Looks like: ticket 1 (b). Representation: none. "Ask Claude" in the tray (clear offline and no-key states, as in Drafting with AI) runs ticket 5 on the open highlight. The suggested dimension is marked in the picker and taken only if Bob picks it. Drafted records show in the tray (ticket 1's choice), sharing rows with `DraftReview` (extract them, don't copy), and dashed on the map. Accepting goes through `upsert`, adds the record to the highlight's `usedBy` and the highlight to a connection's `highlightIds`. A highlight with drafts waiting shows that in Library → Highlights.
   Files: `CaptureTray.tsx`, `src/ui/panels/DraftReview.tsx`, `src/ai/draft.ts`, `MapView.tsx` only if the draft layer needs a new source.
   Done when: an e2e test (recordings replayed) highlights the tribute passage in Pericles, asks Claude, sees "economic" suggested, accepts the drafted event and the "funded" connection, rejects nothing else, sees the event on the map, and sees both records under the highlight in Library. Manual: Highlighting, Drafting with AI.
7. **Phase 2 checkpoint** · S · sonnet. Triage the inbox, write the Phase 3 tickets from the timeline spike report (`docs/spikes/timeline.md`), log decisions. Turn "every kind on both the map and the timeline" into tickets, and lift the tray's block on places, polities and ideas as each one's representation lands.

### Phase 2b — Talk with Socrates
Bob talks about any subject on the timeline with Socrates, as close to Plato's Socrates as we can make him. The three aims: learn the subject, see it in its era and across the six dimensions, and have Bob's assumptions questioned. See the decision "Socrates: a dialogue, not content".

How Socrates talks:
- He says he knows nothing, with a little irony, and asks Bob to teach him.
- He asks "what is it?" questions: what was the polis, what is a revolution, what is piety.
- He tests Bob's answers by elenchus: he gets Bob to agree to small premises one at a time, then shows where they clash with each other or with Bob's first answer.
- He reasons from everyday crafts: the cobbler, the doctor, the pilot, the horse-trainer.
- He works as a midwife: Bob reaches the idea himself, and Socrates doesn't lecture.
- He is happy to end in aporia ("we have not found it yet") and to propose they look again tomorrow.

Subjects after 399 BCE: he doesn't pretend to have lived through them. He says what he has heard read to him (the sources the app gives him) and asks Bob to tell him more.

1. **Prototype: a dialogue with Socrates** · S · opus. Looks like: new. Representation: none. An Artifact laid out like a dialogue (speakers in small caps, SOCRATES and BOB), beside the reader and an entry's panel, on desktop and phone, light and dark. Each line of Socrates' has the passages it rests on one tap away, and a quoted passage offers "Make this a highlight". Two sample dialogues on fixture data: the Peloponnesian War ("Was Athens right to go to war?") and the printing press, far from his time. A/B: a side panel, or the dialogue full page.
   Done when: Bob has picked, and the choices are rules in `docs/design.md`.
2. **Dialogues (schema v7)** · M · opusplan. `Dialogue { id, title, about: { itemId?, sourceId?, highlightIds }, turns: { speaker: 'socrates' | 'bob', text, cites: { sourceId, highlightId?, quote }[], at }[], model, promptVersion, updatedAt }`. Kept in the doc and in backups and merged like the rest; never shown as, or turned into, a note.
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts` (upsert, remove, merge), the upgrade test.
   Done when: v6 backups import, merge handles dialogues, and a dialogue's turns survive export and import. Manual: none (no UI yet).
3. 🤖 **The `socrates` feature** · M · opusplan. Representation: none. `src/ai/socrates/` per `src/ai/CLAUDE.md`. In: the entry's article as a cached system block (`cache_control`), the articles it links to that Bob asks about (fetched one at a time), Bob's highlights and notes on it, what overlaps it in time (the overlap query planned for Meanwhile, in `src/model/atYear.ts`), and the dialogue so far. The prompt sets out the moves above, with short examples from Jowett's public-domain translations (Euthyphro, Meno, Apology). Socrates speaks in short turns, asks one question at a time, and never answers his own questions for Bob. Facts come only from the passages given; where they're silent, he says he has heard nothing of it. Out, through one tool: `{ move: 'ask' | 'test' | 'widen' | 'aporia', text, cites[] }`; the validator drops cites whose quote isn't in the source. Streaming goes in `client.ts`.
   Prompt: `src/ai/socrates/prompt.md`. Cases (`tests/ai-evals/socrates/`): Bob says Athenian democracy was "rule by the people" (Socrates draws out who counted as the people); a planted misconception; a subject long after his death; a question the sources can't answer; Bob asks to be taught outright. Bar: every cite checks out; every turn of his ends in a question or an aporia; no turn runs past about 120 words; the misconception comes out through Bob's own admissions, not by being told; the uncovered question is admitted; a rubric judge finds the voice recognisably Plato's Socrates in at least 4 of 5 cases.
   Files: `src/ai/socrates/`, `src/ai/client.ts` (streaming), `tests/ai-evals/socrates/`.
   Done when: the cases meet the bar in a live run (`ai-eval` skill), and unit tests replay the recordings through the validator. Manual: none (no UI yet).
4. **Socrates in the app** · M · opus. Looks like: ticket 1's pick. Representation: none. "Talk with Socrates" on an entry's panel and in the reader, with clear offline and no-key states. Past dialogues are listed on the entry and in Library, titled the way Plato's are ("Pericles, or on leadership"), and Bob can rename them. A quoted passage can become a highlight Bob keeps.
   Files: new `src/ui/socrates/`, `ItemPanels.tsx`, `ReaderPane.tsx`, `Library.tsx`.
   Done when: an e2e test (recordings replayed) opens Pericles, talks with Socrates for three turns, makes a cited passage a highlight, reloads, and sees the dialogue on the entry and in Library. Manual: a new "Talking with Socrates" section.

### Phase 3 — New timeline
Custom renderer at parity with today's timeline, then levels 0 and 1; vis-timeline removed; `ui.next` becomes the default.

### Phase 4 — Eras, themes and influences
Era bands with theme chips; 🤖 `themes` feature (groups an era's highlights with a suggested label Bob accepts or edits); influences between dimensions (the war on the economy, Christianity on politics, technology on the economy, capitalism on who holds power).

Connection endpoints grow with the schema: each bump that adds a record (v6 themes, v8 regimes, v9 economies, v10 institutions) also makes it something a connection can point at, so nothing gets renumbered.
1. **Prototype: influences across dimensions** · M · opus. An Artifact on fixture data at level 1 (an era's six dimension lanes), in light, dark and phone. A: arrows between items in different lanes, labelled with the effect, with the highlight one tap away. B: an era's "what drove what" grid (six dimensions by six, each cell counting Bob's links) that opens into A. Fixture cases: the Peloponnesian War weakening Athens' economy (Decelea, the Laurion mines), the plague and religion, Delian League tribute paying for the building program. Add any shapes the schema lacks to `tests/fixtures/greece/next.json`.
   Done when: Bob has picked, and the effect vocabulary (caused, enabled, weakened, strengthened, funded, legitimised, …) and the arrow style are rules in `docs/design.md`.
2. **Influences between dimensions** · M · opusplan. Looks like: ticket 1's pick. Representation: new `src/ui/representations/influence.ts`. The connection editor gets an effect (open vocabulary, edited in the app) and "Evidence" (pick highlights). Level 1 draws connections whose two ends are in different dimensions. An entry's panel lists "Effects on other dimensions" both ways ("Weakened: Athenian economy", "Weakened by: Peloponnesian War").
   Files: `src/model/doc.ts` (a cross-dimension query, tested), the connection editor in `src/ui/panels/ItemPanels.tsx`, the renderer's level 1.
   Done when: an e2e test links the war to the economy as "weakened" with a highlight, and sees the arrow cross lanes at level 1 and the line in both panels. Manual: Connections.

### Phase 5 — Polities and wars
Regimes and the power-structure diagram (schema v8, with alliances); regime-styled territories; border morph; campaigns and battles. Folds in paused tickets 3–6, 18 and 20. Build the power-structure diagram from roles and links in general, not polity ones only, because Phase 5c reuses it for schools.

### Phase 5b — Economy
`EconomyProfile` and goods flows (schema v9); sector streamgraph; production sites; economy portrait; 🤖 sector claims from highlights. Alongside what was produced, it also records **how goods reached people**.
1. **Prototype: how goods were distributed** · S · opus. Adds to prototype (e), the economy portrait. Each snapshot gets a distribution band with relative shares of the mechanisms: kinship and gift, redistribution (palace, temple, state), tribute, householding, market exchange, planning. The vocabulary is open, with Polanyi's reciprocity, redistribution and exchange as a starting point. Add a strip that follows the mechanisms across eras: Mycenaean palace redistribution → Archaic households and gift → Classical Athens, where markets in the agora sit beside liturgies and the grain dole.
   Done when: Bob has picked, and the vocabulary and the band's look are in `docs/design.md`.
2. **Distribution in economy profiles** · M · opusplan. Part of the v9 bump, not a bump of its own. `snapshots[].distribution: { mechanism, share?: { measure: 'relative', low?, high? }, institutions?, highlightIds }[]`, where an unknown share stays unknown. Representation: the economy module (band in the portrait, a thin mechanism strip under the sector streamgraph). The 🤖 sector claims also suggest mechanisms.
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts` (merge), the economy representation.
   Done when: the fixture's Athens shows markets and liturgies in 431 BCE, the band changes between snapshots, and v8 backups import. Manual: Economies.

### Phase 5c — Ideas, schools and spread
Technology and idea spread waves; influence arcs; the tech tree (paused ticket 10). Then a history of ideas: where a work or idea was known, lost and revived, how it travelled, and the schools that taught it (schema v10). Bob can still keep a "History of ideas" category for his own topic. This adds a representation, not a kind.
1. **Prototype: history of ideas** · M · opus. Two Artifacts on fixture data, in light, dark and phone. (f) Aristotle's reception: a thread per region on the timeline that thins where his works were lost and brightens where they came back, plus arrows on the map for the translations (Athens → Alexandria → Baghdad's translation movement → Toledo and Sicily → Paris). (g) Plato's Academy against the University of Paris around 1250, shown with the power-structure diagram: who teaches, who learns, who pays, who licenses, the curriculum, and the ties to the city, the church and the crown. The fixture gets a small medieval appendix (test data only).
   Done when: Bob has picked both, and `docs/decisions.md` records whether institutions are a subject type of their own that shares the regime diagram.
2. **Schools and institutions** · M · opusplan. Looks like: (g). v10. An `institution` row in `src/model/subjects.ts` (Wikidata: school, university, academy, madrasa, monastery). `structures` snapshots have the same shape as regimes (roles and links, with link kinds as an open vocabulary: teaches, funds, licenses, governs, examines), plus a curriculum list and `highlightIds`. Representation: new `src/ui/representations/institution.ts` (lifespan bar split by structure, map pin, the diagram morphing between snapshots, two institutions side by side).
   Files: `src/model/types.ts` and the checklist in `src/model/CLAUDE.md`, `doc.ts`, the shared diagram from Phase 5.
   Done when: an e2e test compares the Academy and the University of Paris side by side, and v9 backups import. Manual: Schools and institutions.
3. **Reception and transmission of ideas** · M · opusplan. Looks like: (f). Shares ticket 2's v10 bump, and the two land in the same release. `reception: { where (place, territory or country), from, to?, state: 'known' | 'partial' | 'lost' | 'revived' | 'taught', via?, highlightIds }[]` on idea and work entries. `Flow.subject` gains `'ideas'` for translations and teachers moving, drawn without a rate. A school that teaches a work links to it. Representation: new `src/ui/representations/idea.ts` (reception threads on the timeline, regions tinted by state on the map, transmission arrows).
   Files: as ticket 2, plus `src/ui/mapData.ts` (state by year, tested).
   Done when: an e2e test sees Aristotle "lost" in the Latin West in 900, "revived" in 1200, and the Toledo → Paris arrow. Manual: History of ideas.

### Phase 5d — Living map
The map shows what kind of thing it draws, so it looks alive and teaches at a glance: what sort of border, what each side fought with, what struck, what was found, how an idea or a faith spread. Drawn by us: an icon and line set of our own, and a tap shows real Commons pictures of the thing itself (no AI imagery). Builds on Phase 5's routes, battles and regimes and Phase 5c's idea spread.

1. **Prototype: a living map** · M · opus. One sheet per idea, on fixture data, in light, dark and phone, with a filmstrip for motion:
   - **Kinds of border**: a frontier (an edge that fades out, like the American frontier), a wall (a crenellated line: the Long Walls, Hadrian's Wall), a treaty border (crisp, with posts, like today's US border), contested ground (both claimants' colours interleaved, the front moving as the year plays), claimed or occupied (dashed).
   - **War and its technology**: force icons on routes and battles (hoplite, trireme, legion, cavalry, longbow, musket, cannon, ironclad, tank, aircraft), sized by strength; tap for Commons pictures of the arms and the battle.
   - **Disasters**: earthquake rings, the extent of ash fall, floods, and an epidemic or famine spreading as a tint.
   - **Discoveries in science**: a spark at the place, then a ring as word spreads.
   - **Ideas and religion**: religion as tinted regions with conversion waves; philosophy as threads between thinkers' places and schools, so the two read differently.
   Add the shapes the schema lacks to `tests/fixtures/greece/next.json`, plus a small appendix of later test data (frontier, a modern border, a 20th-century front).
   Done when: Bob has picked, and the icon and line vocabulary is a rule in `docs/design.md`.
2. **Kinds of border and walls** · M · opusplan. Looks like: ticket 1's pick. Representation: the polity module. Schema bump (v11): `TerritorySnapshot.edge?: 'frontier' | 'border' | 'contested' | 'claimed' | 'occupied'`, with claimants for contested ground, and walls as dated line features that can belong to an entry.
   Done when: an e2e test sees Athens' Long Walls in 431 BCE and not in 403 BCE, and a contested area drawn in both claimants' colours; v10 backups import. Manual: Territories.
3. **War technology** · M · opus. Looks like: ticket 1's pick. Representation: the war module. Forces on wars and battles (`{ side, strength?, arms[] }`, where arms link to technology entries by a "used in" connection; in the same v11 bump). A hand-drawn SVG icon set in `src/ui/representations/`; a tap opens Commons pictures (reuse the Commons search in `src/media`).
   Done when: an e2e test sees trireme icons at Salamis and opens their Commons pictures (mocked). Manual: Wars on the map.
4. **Disasters** · M · opusplan. Looks like: ticket 1's pick. Representation: new `src/ui/representations/disaster.ts`. A `disaster` row in `src/model/subjects.ts` (Wikidata: earthquake, eruption, epidemic, famine, flood, tsunami), an affected area, and what it did as connections with an effect.
   Done when: unit tests classify recorded subjects (the plague of Athens, the eruption of Vesuvius in 79), and an e2e test sees the plague's tint in 430 BCE. Manual: Disasters.
5. **Discoveries** · S · sonnet. Representation: the technology module. A `discovery` row in `src/model/subjects.ts` (scientific discovery, theory); a spark at the place, then spread on technology's wave.
   Done when: a recorded discovery classifies, and the spark shows in its year. Manual: Discoveries.
6. **The look of ideas and religion** · M · opus. Looks like: ticket 1's pick. Representation: `src/ui/representations/idea.ts`, plus religion's conversion tint and waves.
   Done when: an e2e test plays a religion's spread and sees regions tint in order, while a philosophy shows as threads. Manual: History of ideas.

### Phase 6 — Other sources
A Cloudflare Worker proxy with Readability for sites without CORS; a bookmarklet and PWA share target ("send to Chronicle").
1. **PDFs and EPUBs** · M · opusplan. Bob uploads a book he owns. Its text is extracted (pdf.js, epub.js), kept in IndexedDB beside the article cache (not in the doc, so backups stay small), and opened in the reader. Highlights anchor by page or EPUB location (the anchor gains a locator: a schema bump), and Socrates can draw on the book too.
   Done when: an e2e test uploads a small PDF and an EPUB, highlights a passage in each, reloads, sees them marked, and sees Socrates cite the PDF (recording replayed). Manual: Reading your own books.

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
