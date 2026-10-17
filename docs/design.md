# Design notes

## Direction
A quiet study tool for one reader. The **pigment palette** is the one bold thing: each category lane takes its color from a historical pigment (lapis, cinnabar, umber, verdigris, ochre, madder, indigo). Everything else stays restrained so the history is what you see.

## Design language for the redesign (draft)
The direction is in `docs/vision.md`; visual references are in `docs/references.md`. The sections marked *proposed* are settled in the Phase 0 prototypes, then written here as rules.

- **Zoom levels.** Level 0: era bands with theme chips. Level 1: an era's six dimension lanes. Level 2: individual entries. Each level shows less detail than the next, never a shrunken copy of it.
- **Representations.** Each subject type has one way of being drawn (the table in `vision.md`). Two subject types never share a glyph.
- **Density.** Era bands and theme chips never hide at level 0: a band grows taller to show all its chips. At levels 1 and 2, when crowded, hide in this order: descriptions, then secondary labels, then minor entries (merged into counts). A span label that doesn't fit sits just after the span if there's room, is cut short with an ellipsis if not, and is hidden (tooltip only) below 48 px. A moment's label hides if it would collide with the one before it.
- **Dimension pigments**: political lapis, economic ochre, social madder, technological verdigris, intellectual indigo, religious cinnabar, always in that order; umber stays for neutral rules and uncertainty.
- **Patterns** carry meaning that color can't: regime forms on polity bars and territories, and how labour and ownership worked in economy treemaps. Every pattern is legible in dark mode and at phone size.
- **Uncertainty** is always visible: dashed edges for approximate dates, soft bands for ranges, "size unknown" tiles, never a confident line for a guess.
- **Type scale**: Spectral SC for era and region names (spaced small caps); Spectral for theme chips, span labels, cards' titles and reading text; Public Sans for controls, lane names, moment labels and axis ticks at levels 1 and 2. The level 0 axis keeps Spectral's old-style numerals.
- **Motion tokens**: `--motion-quick` 150 ms (hover, selection), `--motion-move` 400 ms (zooming between levels, panels), `--motion-morph` tied to the year clock (borders, diagrams, treemaps), and easing `cubic-bezier(.2,.7,.2,1)`. Only change over time animates; decoration never does. With reduced motion, states swap instantly.

## Phase 0 prototypes
Sources are in `docs/prototypes/`; republish one with the Artifact tool after editing it. Sample data only. Build tickets link these as `Looks like:`. The map prototypes inline a Natural Earth 10m coastline clipped to their area, and their sea routes were found through water cells, so fleets never cross land.
- **Era overview**: https://claude.ai/artifact/Vnu3jkQcP2D38HE6JcPQ7j. Bob chose on 2026-10-16: A · Bands and A · Phases. Not chosen: Streams (thickness = how much was highlighted, which folded chips away) and Pulse (highlights per five years).
- **Reader**: https://claude.ai/artifact/DQoHcwpRpcL2AjniH63RF6. Bob chose on 2026-10-16: selecting, with tapping a sentence as an extra on the phone; the capture card in a tray on both laptop and phone. Not chosen: the margin card.
- **War on the map** (ticket 0.3c): https://claude.ai/artifact/WwwBbRxD4FCBLKGLi8tcDr. The Peloponnesian War on the year clock: routes draw in, battles pulse once in the winner's colour, cities take the colour of their side that year, and the war's bar under the map carries its phases and a tick per battle. Open choices: routes as A · Lines (fading as they age) or B · Minard (width = size of the force, a soft band for a range of estimates, dashed when unknown); playback A · Steady (the whole war at an even pace) or B · Guided (the camera follows each campaign and time slows while forces move).
- **How Athens was governed** (ticket 0.3d): https://claude.ai/artifact/655Bst5cfb946u1jG7XBjn. Eleven regimes from the archons to Antipater, morphing as the year crosses each change; a "who had a say" bar of the whole population; Athens and Sparta in 431 BCE side by side on one scale. Open choice: the power structure as A · Chart (who chooses whom, in tiers) or B · Bodies (each institution a circle sized by its members).
- **Athens' economy** (ticket 0.3e): https://claude.ai/artifact/K9PKyrZmwCg4QSxjukT4ak. Six snapshots from 600 to 340 BCE; Black Sea grain, Macedonian timber and Euboean food as flows of goods, cut off in 405–404 and rerouted round Sounion in 413–411; an Attica inset with production sites and the Long Walls; moments where war and economy meet. Open choices: the portrait as A · Treemap or B · Ranges (a bar from the lowest to the highest estimate); the economic lane as A · Stream (thickness = estimated people) or B · Shares (full height).

Proposed by the 0.3 prototypes, to become rules when Bob picks:
- **Regime forms** (polity bars and territories): one ruler solid, the few a 45° hatch, by wealth horizontal bands, the many dots, all in lapis; backed by a foreign power adds an umber bar along the top.
- **Labour textures** (economy portraits and production sites), all in ochre: free family work plain, paid work vertical lines, enslaved work a crosshatch, a mix dots; owned or paid by the state adds a corner notch. A sector nobody can size is a dashed tile with "?", never a guess.
- **Sides in a war** take their alliance's colour; a battle is a circled × in the winner's colour that rings out once when the year reaches it.
- **Goods** move as dots along their route, filled when the amount is known and hollow on a dashed line when it isn't; a cut route turns grey and dashed with a ⊘ where it was cut. Migrations keep moving dashes, so the two never look alike.
- **Play pauses on what matters**: a regime change (the diagram morphs) and a marked moment (its highlight shows on the map) hold the clock for a beat. A war's year card counts summers and winters, as Thucydides does.

## Overview (levels 0 and 1)
- **Level 0 · bands.** One row per region, its name in spaced small caps at the left with its highlight count. Each era is a block: name, dates, Bob's theme chips (a square in the theme's main dimension pigment, then the label and count), and a strip along the bottom showing the mix of dimensions in its highlights. Approximate starts and ends are dashed umber edges. Dragging or the wheel moves through time.
- **Zooming in.** Clicking an era, or Ctrl/⌘-wheel or pinching over it, expands its band into the six lanes over `--motion-move` on one continuous time scale; the other rows fade. Clicking a chip zooms in with that theme picked. "All eras", the Eras stop, Esc or pinching out zooms back.
- **Level 1 · phases.** The era's theme chips run along the top. Six lanes in pigment order, each a faint wash of its pigment, labelled with its name and highlight count. Spans of change are named bars packed into rows (dashed when approximate); key moments are diamonds on a row above. Picking a theme dims everything outside it in every lane. Clicking a span, moment or theme opens the highlights behind it.
- **Phone.** Level 0 pans sideways with the region names above each row. Level 1 becomes a vertical list: per lane, the bars without labels, then a dated list of its spans and moments. Details open in a bottom sheet.
- **Empty lanes** say so in Bob's words ("Nothing economic highlighted here yet.").

## Reader and capture
- **Layout.** Laptop: the reader column (text about 34em wide) beside the map over a timeline strip; a reading trail and "Open an article" in the top bar. Phone: full-screen reader; "Map" opens the map and timeline as a sheet.
- **Highlighting.** Select any words; a "Highlight" button appears above the selection (H on the laptop) or docked at the bottom on the phone. On the phone, a tap also highlights a whole sentence, and tapping the next sentence extends it. A highlight is saved the moment it's made.
- **Capture card in a tray**, on laptop and phone alike. It slides up under the text and the reader scrolls so the highlighted passage stays above it. It shows the quote and section; what it becomes (the kind's glyph, kind and title, or "Already in Chronicle"); facts (When, Where, Part of, and anything else found); a dimension picker with the suggestion marked; then "Add to map and timeline" (or "Link to …"), "Just keep the highlight" and Remove. Moving on keeps an undecided highlight as a plain one.
- **Where facts came from.** Wikidata facts are plain; Claude's suggestions are dashed and say "suggested"; links to entries already in Chronicle are underlined in the pigment. The card says which applies.
- **Drafts.** Until added, a record shows on the map and timeline as a dashed ghost with a "?". Adding it pops the pin in with one ring; nothing else animates.
- **Marks in the text.** The open highlight: a 32% wash of its dimension pigment; kept: 13%; added: 20% plus a pigment underline.
- **Glyphs**, one per kind: war, a bar with ticks (its battles are ticks on the timeline bar); battle, a circled ×; event, a dot; person, a lifeline (a hollow ring on the map); change of government, a hatched square; polity, a solid square; alliance, two rings; place, a pin.

## Tokens (in `src/ui/styles.css`)
- Light: limestone background `#eef0ec`, panel `#fbfbf8`, slate ink `#1d2b3a`, rules `#cfd4cc`.
- Dark: `#131b23` background with lightened pigments. It follows the system setting.
- Type: **Spectral** for titles, notes and anything you read (axis years use old-style numerals), and **Public Sans** for controls.

## Conventions
- Approximate dates are shown with a dashed edge, not a "c." prefix that eats label space.
- Each trend strip has its own scale, and the label says when a strip is log scale.
- The drawer is a side panel on desktop and a bottom sheet under 860px. Its back stack lets you follow links (note → entry → source) and return.
- Copy: sentence case, verbs that say what happens, offline errors that say a connection is needed.

## Map
- Parchment land on slate-blue water with a faint graticule; dark mode inverts to near-black water. Tokens: `--map-water`, `--map-land`, `--map-border`, `--map-river`, `--map-backdrop`.
- Territories take their category's pigment at 30% fill with a solid edge, labelled in spaced small caps (Spectral). Reference borders are dashed ink outlines, deliberately quieter than Bob's own territories.
- Pins are category-colored dots, bigger when selected. Events fade over a few decades after they happen (longer when playing fast). Names show when 40 or fewer pins are visible, and on hover otherwise.
- The choropleth ramps from a tint of the land color to the trend's category pigment, on one scale across all years.

## Checking your work
For the redesign: prototype first (an Artifact on fixture data that Bob picks), then build. Review with the `design-review` skill and hand the sheet to the `design-critic` agent for a fresh-eyes critique. Use a filmstrip or short video for anything that moves.

Screenshot desktop (1440×900), phone (412×860) and dark mode with the fixture imported (`npm run shots` includes map, split and phone-map views). Things to look at: lane-label alignment with the trend strips, clipped labels, and contrast in dark mode.
