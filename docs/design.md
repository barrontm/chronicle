# Design notes

## Direction
A quiet study tool for one reader. The **pigment palette** is the one bold thing: each category lane takes its color from a historical pigment (lapis, cinnabar, umber, verdigris, ochre, madder, indigo). Everything else stays restrained so the history is what you see.

## Design language for the redesign (draft)
The direction is in `docs/vision.md`; visual references are in `docs/references.md`. The sections marked *proposed* are settled in the Phase 0 prototypes, then written here as rules.

- **Zoom levels.** Level 0: era bands with theme chips. Level 1: an era's six dimension lanes. Level 2: individual entries. Each level shows less detail than the next, never a shrunken copy of it.
- **Representations.** Each subject type has one way of being drawn (the table in `vision.md`). Two subject types never share a glyph.
- **Density** *(proposed)*. When crowded, hide in this order: descriptions, then secondary labels, then minor entries (merged into counts). Era bands and theme chips never hide at level 0.
- **Dimension pigments** *(proposed)*: political lapis, economic ochre, social madder, technological verdigris, intellectual indigo, religious cinnabar; umber stays for neutral rules and uncertainty.
- **Patterns** carry meaning that color can't: regime forms on polity bars and territories, and how labour and ownership worked in economy treemaps. Every pattern is legible in dark mode and at phone size.
- **Uncertainty** is always visible: dashed edges for approximate dates, soft bands for ranges, "size unknown" tiles, never a confident line for a guess.
- **Type scale** *(proposed)*: Spectral for era names (large, spaced small caps), theme chips and reading text; Public Sans for controls and axis ticks at levels 1 and 2.
- **Motion tokens** *(proposed)*: `--motion-quick` 150 ms (hover, selection), `--motion-move` 400 ms (zooming between levels, panels), `--motion-morph` tied to the year clock (borders, diagrams, treemaps), and easing `cubic-bezier(.2,.7,.2,1)`. Only change over time animates; decoration never does. With reduced motion, states swap instantly.

## Phase 0 prototypes
Sources are in `docs/prototypes/`; republish one with the Artifact tool after editing it. Sample data only.
- **Era overview** (ticket 0.2a): https://claude.ai/artifact/Vnu3jkQcP2D38HE6JcPQ7j. Open choices: eras as A · Bands or B · Streams (thickness = how much Bob highlighted); dimensions as A · Phases (named spans) or B · Pulse (highlights per five years).
- **Reader** (ticket 0.2b): https://claude.ai/artifact/DQoHcwpRpcL2AjniH63RF6. Open choices: highlight by A · Selecting or B · Tapping a sentence; on the laptop, the capture card in A · the Margin or B · a Tray (the phone always uses the tray).

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
