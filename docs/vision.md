# Vision: read, highlight, see it

Where Chronicle is heading (planned 2026-10-16). A living doc: change it at a phase checkpoint and log why in `decisions.md`. Tickets live in `ROADMAP.md`.

## The two big changes
1. **Reading is how you add.** Bob reads Wikipedia (later other sources) inside the app. One **Add to Chronicle** button on each article puts its subject and what the article describes on the map and timeline at once, as unchecked drafts with one Undo (Bob, 2026-10-25: adding by hand was unwieldy). Highlighting adds what the button missed. The app recognizes what the subject is and draws each kind of thing in its own way. Code does the work where facts are structured (Wikidata); AI only where they aren't (the article's prose). No kind buttons.
2. **Visuals with zoom levels.** Zoomed out: the polities and world events Bob has read about, each polity a strip as thick as its power, over a faint backdrop of eras (Bob, 2026-10-18; it was era bands until the Phase 3 checkpoint). Opening a polity or a world event: how it changed in six lanes (politics, war, economy, philosophy and religion, technology, nature), with the map following. Simple animations: technology spreading, migrations, wars, borders and governments changing.

Nothing appears until Bob has read it and pressed Add, or highlighted it. The app still ships no content.

## Reader and highlights
- **Reader pane:** Wikipedia article HTML (Parsoid REST, `/api/rest_v1/page/html/{title}`, CORS-open), sanitized and set in Chronicle's type. Laptop: beside the map and timeline. Phone: full-screen reader with a capture tray. It works equally on both. Wiki links open in the reader and build a reading trail.
- **Highlight** is a record: `{ id, sourceId, text, anchor: { revisionId, section, exact, prefix, suffix }, dimension?, subjectQid?, usedBy, updatedAt }`. Anchors follow the W3C TextQuoteSelector idea, so highlights survive article edits. Every record can point at the highlights that justify it; today's single `excerpt` migrates into one.
- Articles are cached for offline rereading in IndexedDB, outside the doc.

## Add to Chronicle: a whole article at once
Bob's choice (2026-10-25): one tap, then Undo; the subject plus what the article describes.
- **Code first.** The subject from Wikidata: its kind, its dates with their uncertainty, its places, region, lanes and `part of`; a polity's Seshat borders, or the polity a place was in; connections to what Bob already has; the article as a source and its lead as a highlight. This works without a Claude key.
- **AI second** (`article` feature): the main events, people and actors the article describes (about 20 at most), with lanes, uncertain or competing dates, gradual starts and ends, places by name, and connections with an effect, a date and a certainty. Every record carries the quote behind it, which becomes an anchored highlight. Quotes must be in the article, places come from gazetteers, and nothing Bob has is added twice.
- **Unchecked, not hidden.** Everything lands at once, dashed, with one Undo for the whole article. Bob checks records as he reads them (one at a time or all at once), and any edit checks one. Pressing Add again updates the article without duplicating.

## Uncertain time
Beginnings and ends in history are rarely points. A date keeps its best guess (`y`, so everything sorts and lays out as before) and may add how far it could be off (`earliest`, `latest`), how precise it is (a decade, a century, a millennium) and a qualifier (before, after, by). An entry can hold competing dates, each with its source, and the one Bob chose is drawn solid with the others as ticks. A beginning or end can take time (`transition`): the fall of Rome, the Industrial Revolution and a religion's spread start and end as ramps, not edges. One thing can become another (`transformed-into`): the Roman Republic's strip carries on as the Empire's. Eras belong to a named periodization, and the backdrop shows one at a time, because periodizing is itself an argument.

## Actors, not only states
History is made by more than territorial states. A strip on the timeline can be any actor: a polity, a people, a movement, a religion, a class, a network such as the Hanseatic League, a company. An actor's thickness comes from Bob's strength points or a trend he picks; land area is only a polity's fallback. Where an actor is can be a territory, its places, a region, or nowhere in particular. Ground can be held in several ways (core, claimed, tributary, influence, contested), by more than one actor at once. Places can be uncertain (a soft circle) and change names over time. Rows group by region by default, or by alliance or network, lane, or Bob's own groups. A seventh lane, **Society**, holds class, gender, family, labour, slavery, demography and everyday life.

## Arguments
History is learned as questions as much as facts. A `Question` ("Why did the Western Roman Empire fall?") holds positions, each with who argued it, its evidence and the records it relies on, and sits as a chip on the eras and polities it concerns. Connections carry a certainty (established, argued, speculative). Add to Chronicle drafts questions from an article's historiography sections.

## Recognition: code first, AI second
- `src/model/subjects.ts` (pure, tested): page → Wikidata QID → P31/P279 class chain → `person | polity | period | war | battle | event | movement/idea | technology | economy | work | place | migration`. Facts: P580/P582/P585 dates, P625 coordinates, P361 part of, P155/P156 follows/followed by, P710 participants, P276 location, P122 form of government.
- A highlight can become the article's subject, a subject linked in the passage (its wiki links, classified as above), or something with no article of its own. The first two are code; only the third needs AI, asked for on demand.
- AI features (rules in `src/ai/CLAUDE.md`):
  - `highlight`: from a highlight and its section, extract claims (dates, place names for the gazetteers, actors, quantities, institutions for regimes, sectors for economies) and a dimension. The article text is prompt-cached.
  - `themes`: group an era's highlights into themes with a suggested short label. Bob accepts or edits each.

## Representations
One module per subject type in `src/ui/representations/`, each declaring its timeline glyph, map layers and animation.

Every kind of thing has a representation on both the timeline and the map (Bob, 2026-10-17). A kind needs both columns filled in before it gets a row.

| Subject | Timeline | Map | Animation |
|---|---|---|---|
| Era/period | a labelled wash behind its region's polity strips, with theme chips | tinted extent | crossfade between eras |
| Polity | at the top: a strip as thick as its power, split by regime; opened: its six lanes | territory, styled by regime; picked, the polities it dealt with | thickness changes as the year plays; border morph; power-structure diagram morphs between regimes |
| World event (an entry marked as one) | gold, at the top; opened: its six lanes | gold pin or extent | as its kind |
| Economy | economic lane as a sector streamgraph | production sites, trade flows of goods | sectors grow and shrink; goods flow |
| War | span with battle ticks | campaign routes, battle pins | routes draw in, battles pulse |
| Battle | tick on its war's span (a point of its own when it has no war) | battle pin | pulses in its year |
| Event | point, or a short span | pin at its place | a ring when its year arrives |
| Person | lifeline | born/died/active pins | none |
| Technology | point, tech tree | diffusion pins | spread wave as the year plays |
| Work (book, play, artwork, building) | point at its making, linked to its maker's lifeline | pin where it was made or stands | none |
| Place (city, site, region) | lifespan bar from founding to abandonment, when known | pin or outline | fades in when founded, out when abandoned |
| Migration | span | flow arrows | moving dashes |
| Movement/idea | span; reception threads per region (thin where lost, bright where revived) | influence arcs; regions tinted by reception; transmission arrows | arcs spread outward; threads brighten on revival |
| Institution (school, university) | lifespan bar, split by structure | pin | structure diagram morphs between snapshots |
| Disaster (earthquake, eruption, epidemic, famine, flood) | point or span | affected area | rings, ash fall, a spreading tint |
| Discovery (science) | point | spark at the place | a ring as word spreads |
| Religion | span | regions tinted by adherence | conversion waves |
| Influence (connection across lanes) | arrow between level-1 lanes, labelled with its effect | none | none |

Borders also show their kind (Phase 5d): a frontier fades out, a wall is a crenellated line, a treaty border is crisp, contested ground interleaves both claimants' colours, a claim or occupation is dashed. Wars carry force icons for the arms each side used. Icons and lines are drawn by us; a tap shows real Commons pictures.

### Polity: how it was governed
`regimes: { from, to?, form, institutions: { id, name, role, selection?, powers? }[], links: { from, to, kind: 'elects' | 'appoints' | 'advises' | 'checks' | 'commands' }[], highlightIds, citations }[]`. `form` is an open vocabulary (monarchy, tyranny, oligarchy, democracy, republic, empire, federation, theocracy, occupied/client, …). Seeded from Wikidata P122; institutions come from Bob's highlights. The timeline bar splits into regime segments, each with a pattern per form, and the territory's edge and texture follow the regime. A power-structure diagram (who elects, appoints and checks whom) morphs as the year plays. Polities can be compared side by side, for example Athens vs Sparta in 431 BCE.

### Economy: sectors, their nature and size
`EconomyProfile { id, title, polityId? | regionKeys?, snapshots: { from, to?, sectors: { sector, nature[], size?: { measure: 'output' | 'labour' | 'value' | 'relative', low?, high?, unit? }, places?, highlightIds }[] }[], highlightIds, citations, drafted?, updatedAt }`. Sectors and natures are open vocabularies. Sizes keep their uncertainty (a range, or relative), and an unknown size stays unknown, never invented. Goods move as `Flow`s with `subject: 'goods'`. The views are a sector streamgraph in the economic lane, production sites on the map, and an economy portrait (a treemap with texture for how labour and ownership worked) that animates between snapshots. Each snapshot also records **how goods reached people**: `distribution: { mechanism, share?, institutions?, highlightIds }[]`, with mechanisms as an open vocabulary (kinship and gift, redistribution, tribute, householding, market exchange, planning), shown as a band in the portrait.

### Ideas and schools
An idea or work keeps a `reception` by region (known, partial, lost, revived, taught), and transmission is a `Flow` with `subject: 'ideas'`. Schools and universities are institutions whose `structures` have the same shape as regimes (roles, plus links such as teaches, funds, licenses), so one diagram serves the Academy, the University of Paris and Athens' democracy.

### Influences between lanes
A connection can carry an `effect` (weakened, funded, legitimised, …) and the highlights that justify it. When its two ends sit in different lanes, level 1 draws it as an arrow between the lanes. Ends can be entries, themes, regimes, economies or institutions.

## Timeline with zoom levels
- The timeline is **the overview**: polities and world events in the spirit of the 1931 Histomap, over a backdrop of eras (below).
- Opening a polity, world event or era unfurls its six lanes showing change right under it, in place; several can be open at once (Bob, 2026-10-25, which dropped the level of single entries).
- A custom renderer replaces vis-timeline behind the same one-importer boundary, and lifts the ±271k-year limit. The spike settled it: a pure layout plus an SVG painter (the hybrid only if a real phone needs it), our own Pointer Events driver instead of d3-zoom, and time in decimal years.
- Lanes live on highlights and entries, several per entry. Categories stay Bob's own topics: filter chips, not rows down the left.

## The overview: polities and world events
Bob's direction at the Phase 3 checkpoint (2026-10-18). Phase 4's prototype settles the look.

- **What's at the top.** Polities (nations, empires, republics, leagues of city-states) and world events: the Reformation, the split of the Roman Empire, the spread of Christianity, Islam and Judaism, world-changing inventions such as the steam engine. World events are gold, which marks their weight, and need no row or category of their own. Bob can mark any entry "Show in the overview", and any entry as a world event (`overview: 'shown' | 'world'`, v9).
- **Thickness is power.** An actor's strip is as thick as its power, reach and population in each year. Athens starts as a sliver, grows as its power does, and thins as Macedon comes to dominate. Bob's relative strength (1 to 5, at any date, citing a highlight) wins; else a trend he picks for it (population, adherents, ships); else, for a polity only, the area of its borders that year (`areaKm2`), which flatters land empires over sea and trading powers (Phase 4c). An actor with none of these is one even width.
- **Related polities sit together.** Rows are ordered by geography and history: by default (Bob can move a band himself and rename, merge and outline regions: small tickets S7 to S9) Classical Greece beside Macedon and Persia, the Chinese dynasties far off. Region parents group them (Mediterranean › Greece), and a group of city-states can fold into one row (Classical Greece) and open into Athens, Sparta and Corinth.
- **Eras are the backdrop.** Each region's eras are a faint labelled wash behind its strips, so "Classical" still reads at a glance; theme chips sit on the wash.
- **Opening a polity or world event** drops its six lanes beneath its strip, each a sub-timeline of changes. Before a lane is opened it already shows its most important changes (by `prominence`); opening it shows all of them, and how they relate to the other lanes (influences, Phase 4b). The lanes don't appear at the top; only under what is open.
- **The six lanes** (Bob's): **Politics** (constitutions, laws, leaders, movements), **War**, **Economy** (production, and how goods were distributed: the state, markets, kinship…), **Philosophy and religion** (leaders, texts, schisms), **Technology** (inventions, tools, techniques, discoveries), **Nature** (climate, disasters, disease, the land and its resources). Phase 4c adds a seventh, **Society** (class, gender, family, labour, slavery, demography, everyday life), which v9 had left to the automatic sort. No People lane: notable people sit in each lane they belong to. An entry can be in several (the Reformation is religious and political). Lanes are sorted automatically from what a thing is and its highlights, and what Bob sets always wins.
- **The map follows.**
  - Picking a polity shows it and the polities it dealt with at the year shown (trade, war, crusades, alliances), each marked with how.
  - An open lane shows its layer: **War** highlights every participant in its wars (with today's zoom to a category), **Economy** shows production sites and flows of goods, **Philosophy and religion** shows where thinkers were born, their schools and traditions, religious leaders and movements, **Technology** shows where inventions appeared and how they spread, **Nature** shows disasters, epidemics and climate over the areas they touched, **Politics** shows political change as the year plays. Each later phase's map layer is also its lane's layer.
  - Clicking an area of the map grows the polities, events and people of that region slightly on the timeline and fades the rest into the background, still visible.
- One year clock (`useYearClock`) drives the timeline, the map and every animation. Reduced motion is respected.

## Long range: many things, still clear
Bob will add thousands of things across millennia. Zoomed out, the timeline should stay calm and still show what matters and how it connects (Bob, 2026-10-18). Speed isn't the problem: the spike's layout takes 0.1–2 ms a frame at 50,000 entries. What needs a plan is what to draw. The look is settled in Phase 4's overview prototype, which took over the long-range one; until then these are the ideas it tests. Where they say era bands and region rows, read polity strips and their groups too: the overview keeps eras only as a backdrop.

- **Prominence** comes from Bob's own work, never from an outside ranking: the highlights, connections and notes on an entry (weights set in the prototype), plus the overview mark he sets (which replaced the planned landmark star at the Phase 3 checkpoint). One pure `prominence(entry, doc)` in `src/model/` decides landmarks, which entry leads a cluster, and which labels win when they collide.
- **Landmarks in bands.** At level 0 each era band shows its most prominent wars, people and events (as many as fit) as their kind's glyph. The rest are in the band's count.
- **Clusters that split.** Entries that would overlap merge into a badge in their kind's glyph with a count ("12 battles", "8 people"), labelled with its most prominent member. Zooming in splits it over `--motion-move` (a fade with reduced motion); tapping one zooms to fit it. A cluster holds one kind in one row, so a badge always says one thing.
- **Threads.** Connections are rolled up by the eras their ends fall in: an end belongs to the era of its region whose dates contain it, or the era it is `part of`. Each pair of eras gets one ribbon, its width the number of links, coloured by the main effect's dimension, labelled "4 · influenced". Ribbons run in the gutters between region rows, never over a band's text.
  - **On focus** by default: hover (laptop) or tap (phone) an era, landmark, cluster or theme chip and its threads light up across every era and region, while unrelated bands fade. Esc or tapping empty space clears it.
  - **"Show all threads"** (a setting, remembered per device) draws every ribbon faintly, and focus brightens its own. Laptop only; the phone stays on focus.
  - Tapping a ribbon lists the connections inside it, with their effects and evidence. Zooming in turns ribbons back into single arrows (levels 1 and 2).
- **Threads on the map, over time.** The same focus drives the map, both ways, and the year clock plays it. A thread is an arc between its ends' places that draws in the year its connection happened, then settles to a faint trace. For an idea or work, the regions it reached are tinted by its reception (known, lost, revived; Phase 5c). Played through, Bob sees a story move: Greek philosophy from Athens to Alexandria and Baghdad's translators, the Latin West fading to "lost" for centuries, then its return through Córdoba and Toledo to Paris. Arcs follow known routes (sea legs from `scripts/sea-route.mjs`), otherwise great circles. "Show all threads" also applies here: every arc active in the year, faint. This is the same map layer as Phase 5c's transmission arrows, generalised to any connection.
- **Lenses.** Chips above level 0 (Wars, People, Ideas, Trade, and any of Bob's categories), each adding a thin strip under every region row: war ticks, how many people lived then, idea spans. Off by default and remembered per device. They add strips and never move the bands.
- **Collapsible regions.** Regions can have a parent (Mediterranean › Greece, Rome). A parent row folds its children into one, unfolds on tap, and remembers. A row is as tall as its content, so an almost empty region is thin.

## Schema path
- v6: `highlights`, `dimension`, `themes` on periods; `effect` and `highlightIds` on connections.
- v7: `subject` and `region` on entries, for the new timeline.
- v8: places may have no start or no end (done, Phase 3 ticket 4).
- v9: `lanes` on entries and highlights (filled from `dimension`), the overview mark, `strength` and `region` on territories, region parents, polity groups, territories as connection ends (with a side).
- v10: regions as records (`Region`: name, larger area, place in the band order, outline on the map), filled from the region names in use and `regionParents`.
- v11: uncertain dates (`earliest`, `latest`, `precision`, `qualifier`), competing dates and `transition` on entries, `unchecked` drafts, `when` and `certainty` and new types on connections, the Society lane.
- v12: actors that aren't territories (`group`), holds on territory snapshots, uncertain places and names over time.
- v13: questions with positions, periodizations.
- v14: `regimes` on actors, alliances, and campaign routes on wars.
- v15: `economies` (with `distribution`), plus `Flow.subject` and `goods`.
- v16: `institutions` with `structures`, `reception` on ideas and works, `Flow.subject: 'ideas'`.
- v17: kinds of border (`edge` on territory snapshots), walls, forces on wars and battles.

Each bump that adds a record also makes it a valid connection endpoint.

Every bump follows `src/model/CLAUDE.md`. Changes are additive, so old backups always import.

## Phases
Each phase ships something usable, behind a "Try the new layout" setting (`ui.next`) until the new timeline reaches parity at the end of Phase 3.

0. Design and spikes: design language, prototypes, spikes, rich fixture
1. Reader: reader pane, highlights (v6), recognition, offline cache
2. Highlight → record: code path, AI `highlight` feature, review
3. New timeline: `subject` and `region` (v7), renderer at parity, every kind drawn as itself, then the zoom levels; vis-timeline removed
4. The overview: lanes (v9), polities from the tray, polity strips and world events, a polity's six lanes, the map following; the classic layout dropped
   - Small tickets after it: add from a lane; borders from Seshat (Cliopatria); the polity a place was in
   - 4b. Themes, influences between lanes, threads; eras on the map; lenses, regions and groups in the app
   - Small tickets after it: the overview is the timeline (lanes open in place); regions Bob edits (v10): rename, merge, his own band order, edits on the timeline, outlines on the map
   - 4c. Whole articles, uncertainty and actors: Add to Chronicle, uncertain dates and the Society lane (v11), actors and softer geography (v12), questions and periodizations (v13)
5. Polities and wars: regimes (v14), border morph, alliances, campaigns, battles
   - 5b. Economy, with distribution (v15)
   - 5c. Ideas, schools and spread (v16)
   - 5d. Living map: kinds of border and walls, war technology, disasters, discoveries, the look of ideas and religion (v17)
6. Other sources: Worker proxy with Readability, bookmarklet / share target, PDFs and EPUBs Bob uploads

A checkpoint session closes each phase. It triages the ideas inbox, reorders what's left and logs changes.

## How we work on it
- **Design before build.** Each phase opens with prototype Artifacts on fixture data. Bob picks on laptop and phone, and build tickets link the chosen one as `Looks like:`.
- **Subagents:** use them for parallel Phase 0 spikes (each in its own worktree), the `design-critic` review, fixture drafting and wide searches. Never for parallel build tickets: schema bumps are serial and `App.tsx`, `styles.css` and `doc.ts` are shared.
- **Visual quality:** follow the design language in `design.md`, the reference board in `references.md`, a dev-only gallery (`/#gallery`) for stable shots, filmstrips and short videos for motion, and a fresh-eyes critique.
- **Staying flexible:**
  - New ideas go in the inbox and are tried as prototypes before they touch the schema.
  - A new kind of thing = one row in `subjects.ts` + one representation module.
  - Vocabularies are edited in the app.
  - Half-finished work hides behind flags.
