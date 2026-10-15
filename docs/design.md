# Design notes

## Direction
A quiet study tool for one reader. The **pigment palette** is the one bold thing: each category lane takes its color from a historical pigment (lapis, cinnabar, umber, verdigris, ochre, madder, indigo). Everything else stays restrained so the history is what you see.

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
Screenshot desktop (1440×900), phone (412×860) and dark mode with the fixture imported (`npm run shots` includes map, split and phone-map views). Things to look at: lane-label alignment with the trend strips, clipped labels, and contrast in dark mode.
