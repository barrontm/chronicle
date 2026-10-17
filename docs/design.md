# Design notes

## Direction
A quiet study tool for one reader. The **pigment palette** is the one bold thing: each category lane takes its color from a historical pigment (lapis, cinnabar, umber, verdigris, ochre, madder, indigo). Everything else stays restrained so the history is what you see.

## Design language for the redesign (draft)
The direction is in `docs/vision.md`; visual references are in `docs/references.md`. The sections marked *proposed* are settled in the Phase 0 prototypes, then written here as rules.

- **Zoom levels.** Level 0: era bands with theme chips. Level 1: an era's six dimension lanes. Level 2: individual entries. Each level shows less detail than the next, never a shrunken copy of it.
- **Representations.** Each subject type has one way of being drawn (the table in `vision.md`). Two subject types never share a glyph.
- **Density.** Era bands and theme chips never hide at level 0: a band grows taller to show all its chips. At levels 1 and 2, when crowded, hide in this order: descriptions, then secondary labels, then minor entries (merged into counts). A span label that doesn't fit sits just after the span if there's room, is cut short with an ellipsis if not, and is hidden (tooltip only) below 48 px. A moment's label hides if it would collide with the one before it.
- **Dimension pigments**: political lapis, economic ochre, social madder, technological verdigris, intellectual indigo, religious cinnabar, always in that order; umber stays for neutral rules and uncertainty.
- **Patterns** carry meaning that color can't. Every pattern is legible in dark mode and at phone size.
  - Regime forms, in lapis on polity bars and territories: one ruler solid, the few a 45° hatch, by wealth horizontal bands, the many dots. Backed by a foreign power adds an umber bar along the top.
  - How the work was done, in ochre on economy portraits and production sites: free family work plain, paid work vertical lines, enslaved work a crosshatch, a mix dots. Owned or paid by the state adds a corner notch.
- **Uncertainty** is always visible: dashed edges for approximate dates, soft bands for ranges, "size unknown" tiles, never a confident line for a guess.
- **Type scale**: Spectral SC for era and region names (spaced small caps); Spectral for theme chips, span labels, cards' titles and reading text; Public Sans for controls, lane names, moment labels and axis ticks at levels 1 and 2. The level 0 axis keeps Spectral's old-style numerals.
- **Motion tokens**: `--motion-quick` 150 ms (hover, selection), `--motion-move` 400 ms (zooming between levels, panels), `--motion-morph` tied to the year clock (borders, diagrams, treemaps), and easing `cubic-bezier(.2,.7,.2,1)`. Only change over time animates; decoration never does. With reduced motion, states swap instantly.

## Phase 0 prototypes
Sources are in `docs/prototypes/`; republish one with the Artifact tool after editing it. Sample data only. Build tickets link these as `Looks like:`. The map prototypes inline a Natural Earth 10m coastline clipped to their area, and their sea routes come from `scripts/sea-route.mjs`, so fleets never cross land.
- **Era overview**: https://claude.ai/artifact/Vnu3jkQcP2D38HE6JcPQ7j. Bob chose on 2026-10-16: A · Bands and A · Phases. Not chosen: Streams (thickness = how much was highlighted, which folded chips away) and Pulse (highlights per five years).
- **Reader**: https://claude.ai/artifact/DQoHcwpRpcL2AjniH63RF6. Bob chose on 2026-10-16: selecting, with tapping a sentence as an extra on the phone; the capture card in a tray on both laptop and phone. Not chosen: the margin card.
- **War on the map**: https://claude.ai/artifact/WwwBbRxD4FCBLKGLi8tcDr. Bob chose on 2026-10-17: B · Minard routes and A · Steady playback. Not chosen: plain lines (they hid the size of each force) and Guided playback (the camera following each campaign while time slowed).
- **How Athens was governed**: https://claude.ai/artifact/655Bst5cfb946u1jG7XBjn. Bob chose on 2026-10-17: B · Bodies. Not chosen: the Chart of who chooses whom in labelled boxes.
- **Athens' economy**: https://claude.ai/artifact/K9PKyrZmwCg4QSxjukT4ak. Bob chose on 2026-10-17: A · Treemap and A · Stream. Not chosen: Ranges (low-to-high bars per sector) and Shares (a full-height lane).

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

## Wars on the map
- **Sides** take their alliance's colour (the sample: Delian League lapis, Peloponnesian League cinnabar). Cities are polity squares in the colour of the side they're on that year, an outline when neutral; a fort is an outlined square.
- **Campaign routes, Minard style.** A route is as wide as its force, in men (a trireme carried about 200): 22 px for 40,000 on the laptop, 0.6× on the phone, never under 1.6 px. A force that changes along the way tapers point by point (the retreat from Syracuse, 40,000 to 7,000). When sources disagree, a soft band at the highest estimate sits behind a solid core at the lowest. An unknown size is a 1.6 px dashed line. The head carries an arrow and, while it draws, the route's name and size.
- **Routes draw in** between their dates on the year clock, then fade to about a quarter over a year and a half and stay, so the end of the war is a map of the whole of it.
- **Battles** are a circled × in the winner's colour that rings out once (two rings, about a second) when the year reaches it; no ring with reduced motion. Recent battles are labelled, older ones on hover. Clicking one opens a card: kind, title, season, outcome, what happened, the highlights behind it.
- **Playback is steady**: an even pace (0.7 years a second at 1×, with ½× and 2×), showing the whole war. On the laptop that is Sicily to the Hellespont; on the phone, Greece and the Aegean, with "All" for the rest. Drag pans, the wheel or a pinch zooms.
- **The war's bar** under the map is the war glyph at full size: its phases as segments (a peace lighter and in italics), a tick per battle in the winner's colour, and a playhead to drag. The year card counts summers and winters, as Thucydides does: "Summer of 425 BCE · Year 7 of 27 · Archidamian War".

## Polities: how they were governed
- **Bodies.** Each institution is a circle whose area is its number of members: offices at the top, councils and courts in the middle, assemblies at the bottom. Each keeps its place across regimes, so a change reads as circles growing, shrinking, appearing and going. A soft ring reaches to the high end of a range; a dashed circle means the number is unknown; a faint outline is an institution in name only; a foreign power is umber, at the side.
- **Links** between them: an arrow for elects or chooses, an open arrow for prepares business for, a bar end for checks or can overturn, a heavy arrow for commands, each labelled ("by lot", "can strike down decrees"). Two links between one pair sit side by side.
- **Changes** morph over about a second when the year crosses one, and Play holds there for a beat. Reduced motion swaps them.
- **Who had a say**: one bar of everyone who lived there, on a scale shared by every polity and year: could vote in lapis, free without a vote in a lapis wash, enslaved in grey, a faint band for the range of the total, and a black tick and label for the few who held power. Before there are numbers, a dashed outline says so.
- **The polity's bar** is split into its regimes, patterned by form, with a dashed "not read yet" after the last one Bob has read about. Arrows step between regimes; the card says what changed and shows the highlights.
- **Side by side**: two polities in one year on the same scale (Athens and Sparta in 431 BCE), then a short table of who could vote, how officials were chosen, who led the army and who could stop a decision. On the phone they stack.

## Economies
- **The portrait is a treemap.** A tile's area is the sector's share of the people working (the middle of its range), and its texture says how the work was done. Farming is a column and the other sectors sit in rows, always in the same order, so snapshots morph over about two-thirds of a second without tiles jumping. A tile shows its name, its range ("38–55%") and who did the work while they fit; a sector nobody can size is a dashed tile with "?", never a guess. The portrait says which snapshot it shows, and holds it until the next.
- **The economic lane is a stream** whose thickness is the estimated number of people, so the economy swells and shrinks; layers keep the sector order, alternate two ochre tints with a gap between them, and are labelled where thickest. Umber lines mark the snapshots the shape is drawn from; diamonds mark moments; after the last snapshot, a dashed "not read yet".
- **Goods** move as dots along their route: filled, on a band as wide as the amount, when the amount is known; hollow on a dashed line when it isn't. A cut route turns grey and dashed with a ⊘ where it was cut. Migrations keep their moving dashes, so the two never look alike.
- **Production sites** are squares in their sector's texture; an idle one is a dashed outline. A home region too small for the main map gets an inset (Attica, with the Long Walls while they stand). Picking a sector lights up its sites and its layer and shows its highlights.
- **Moments** where the economy turns (the silver strike, Decelea, the grain cut off) hold Play for a beat and show their highlight in the year card.

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
