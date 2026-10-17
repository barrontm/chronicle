# Vision: read, highlight, see it

Where Chronicle is heading (planned 2026-10-16). A living doc: change it at a phase checkpoint and log why in `decisions.md`. Tickets live in `ROADMAP.md`.

## The two big changes
1. **Reading is how you add.** Bob reads Wikipedia (later other sources) inside the app, highlights what matters, and the app turns highlights into records on the map and timeline. It recognizes what the subject is and draws each kind of thing in its own way. Code does the work where facts are structured (Wikidata); AI only where they aren't (the highlighted prose). No Add button, no kind buttons.
2. **Visuals with zoom levels.** Zoomed out: eras, each showing what it's known for, built from Bob's own highlights. Zoomed into an era: how it changed across six dimensions (political, economic, social, technological, intellectual, religious). Simple animations: technology spreading, migrations, wars, borders and governments changing.

Nothing appears until Bob has read and highlighted it. The app still ships no content.

## Reader and highlights
- **Reader pane:** Wikipedia article HTML (Parsoid REST, `/api/rest_v1/page/html/{title}`, CORS-open), sanitized and set in Chronicle's type. Laptop: beside the map and timeline. Phone: full-screen reader with a capture tray. It works equally on both. Wiki links open in the reader and build a reading trail.
- **Highlight** is a record: `{ id, sourceId, text, anchor: { revisionId, section, exact, prefix, suffix }, dimension?, subjectQid?, usedBy, updatedAt }`. Anchors follow the W3C TextQuoteSelector idea, so highlights survive article edits. Every record can point at the highlights that justify it; today's single `excerpt` migrates into one.
- Articles are cached for offline rereading in IndexedDB, outside the doc.

## Recognition: code first, AI second
- `src/model/subjects.ts` (pure, tested): page → Wikidata QID → P31/P279 class chain → `person | polity | period | war | battle | event | movement/idea | technology | economy | work | place | migration`. Facts: P580/P582/P585 dates, P625 coordinates, P361 part of, P155/P156 follows/followed by, P710 participants, P276 location, P122 form of government.
- A highlight can become the article's subject, a subject linked in the passage (its wiki links, classified as above), or something with no article of its own. The first two are code; only the third needs AI, asked for on demand.
- AI features (rules in `src/ai/CLAUDE.md`):
  - `highlight`: from a highlight and its section, extract claims (dates, place names for the gazetteers, actors, quantities, institutions for regimes, sectors for economies) and a dimension. The article text is prompt-cached.
  - `themes`: group an era's highlights into themes with a suggested short label. Bob accepts or edits each.

## Representations
One module per subject type in `src/ui/representations/`, each declaring its timeline glyph, map layers and animation.

| Subject | Timeline | Map | Animation |
|---|---|---|---|
| Era/period | band with theme chips | tinted extent | crossfade between eras |
| Polity | lifespan bar, split by regime | territory, styled by regime | border morph; power-structure diagram morphs between regimes |
| Economy | economic lane as a sector streamgraph | production sites, trade flows of goods | sectors grow and shrink; goods flow |
| War | span with battle ticks | campaign routes, battle pins | routes draw in, battles pulse |
| Person | lifeline | born/died/active pins | none |
| Technology | point, tech tree | diffusion pins | spread wave as the year plays |
| Migration | span | flow arrows | moving dashes |
| Movement/idea | span; reception threads per region (thin where lost, bright where revived) | influence arcs; regions tinted by reception; transmission arrows | arcs spread outward; threads brighten on revival |
| Institution (school, university) | lifespan bar, split by structure | pin | structure diagram morphs between snapshots |
| Influence (connection across dimensions) | arrow between level-1 lanes, labelled with its effect | none | none |

### Polity: how it was governed
`regimes: { from, to?, form, institutions: { id, name, role, selection?, powers? }[], links: { from, to, kind: 'elects' | 'appoints' | 'advises' | 'checks' | 'commands' }[], highlightIds, citations }[]`. `form` is an open vocabulary (monarchy, tyranny, oligarchy, democracy, republic, empire, federation, theocracy, occupied/client, …). Seeded from Wikidata P122; institutions come from Bob's highlights. The timeline bar splits into regime segments, each with a pattern per form, and the territory's edge and texture follow the regime. A power-structure diagram (who elects, appoints and checks whom) morphs as the year plays. Polities can be compared side by side, for example Athens vs Sparta in 431 BCE.

### Economy: sectors, their nature and size
`EconomyProfile { id, title, polityId? | regionKeys?, snapshots: { from, to?, sectors: { sector, nature[], size?: { measure: 'output' | 'labour' | 'value' | 'relative', low?, high?, unit? }, places?, highlightIds }[] }[], highlightIds, citations, drafted?, updatedAt }`. Sectors and natures are open vocabularies. Sizes keep their uncertainty (a range, or relative), and an unknown size stays unknown, never invented. Goods move as `Flow`s with `subject: 'goods'`. The views are a sector streamgraph in the economic lane, production sites on the map, and an economy portrait (a treemap with texture for how labour and ownership worked) that animates between snapshots. Each snapshot also records **how goods reached people**: `distribution: { mechanism, share?, institutions?, highlightIds }[]`, with mechanisms as an open vocabulary (kinship and gift, redistribution, tribute, householding, market exchange, planning), shown as a band in the portrait.

### Ideas and schools
An idea or work keeps a `reception` by region (known, partial, lost, revived, taught), and transmission is a `Flow` with `subject: 'ideas'`. Schools and universities are institutions whose `structures` have the same shape as regimes (roles, plus links such as teaches, funds, licenses), so one diagram serves the Academy, the University of Paris and Athens' democracy.

### Influences between dimensions
A connection can carry an `effect` (weakened, funded, legitimised, …) and the highlights that justify it. When its two ends sit in different dimensions, level 1 draws it as an arrow between the lanes. Ends can be entries, themes, regimes, economies or institutions.

## Timeline with zoom levels
- Level 0: era bands in the spirit of the 1931 Histomap, with theme chips.
- Level 1: inside an era, six dimension lanes showing change.
- Level 2: individual entries.
- A custom renderer (d3-scale/d3-zoom, SVG, canvas if density needs it) replaces vis-timeline behind the same one-importer boundary, and lifts the ±271k-year limit. This is the one hard-to-undo step, so it gets a spike first.
- Dimensions live on highlights and entries and are the default lanes at level 1. Categories stay Bob's own topics.
- One year clock (`useYearClock`) drives the timeline, the map and every animation. Reduced motion is respected.

## Schema path
- v6: `highlights`, `dimension`, `themes` on periods; `effect` and `highlightIds` on connections.
- v7: `regimes` on territories, and alliances.
- v8: `economies` (with `distribution`), plus `Flow.subject` and `goods`.
- v9: `institutions` with `structures`, `reception` on ideas and works, `Flow.subject: 'ideas'`.

Each bump that adds a record also makes it a valid connection endpoint.

Every bump follows `src/model/CLAUDE.md`. Changes are additive, so old backups always import.

## Phases
Each phase ships something usable, behind a "Try the new layout" setting (`ui.next`) until the new timeline reaches parity at the end of Phase 3.

0. Design and spikes: design language, prototypes, spikes, rich fixture
1. Reader: reader pane, highlights (v6), recognition, offline cache
2. Highlight → record: code path, AI `highlight` feature, review
3. New timeline: renderer at parity, then the zoom levels; vis-timeline removed
4. Eras, themes and influences between dimensions
5. Polities and wars: regimes (v7), border morph, alliances, campaigns, battles
   - 5b. Economy, with distribution (v8)
   - 5c. Ideas, schools and spread (v9)
6. Other sources: Worker proxy with Readability, bookmarklet / share target

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
