# Spike (c): animation on the map

Phase 0, ticket 4, run on 2026-10-17. Code, demo, filmstrips and raw numbers (`results-*.json`) are on branch `spike/map-motion` under `spikes/map-motion/`. Nothing is merged. MapLibre is 6.11.2. Serve the demo over http (`node spikes/map-motion/serve.mjs`), because from `file://` the MapLibre worker fails.

## Recommendation
- **Border morph: our own, with no dependency (about 2 KB).**
  - Resample by arc length, pick the best rotation, interpolate linearly.
  - Match polygons greedily. Leftover pieces shrink into or grow from a partner, and holes are matched or collapsed.
  - Crossfade is the cheap fallback.
- **Route drawing: slice at progress p.**
  - `setData` runs only for routes still drawing; finished routes move to a static source.
  - Fades use feature-state, which doesn't re-tile.
  - `line-gradient` can't taper or dash, and `line-trim-offset` doesn't exist in 6.11.2.
- **Taper: one ribbon polygon per route, built in pure code.**
  - The estimate band is a second polygon, and the head triangle has its own source.
  - At pixel width, the ribbon is rebuilt on zoom, which takes about 0.2 ms.
  - Per-segment lines look fine, but fading them stacks alpha at the joints, because opacity is per layer.
- **Battle pulses: HTML markers with a CSS animation.** They need no JS per frame.
- **Clock: one store, `{year, playing, speed}`, with one rAF loop.**
  - React reads slices through `useYearClock(selector)`.
  - The map and the timeline playhead subscribe with `onFrame`.

## Numbers
All figures are fps for the median run. GPU is the Apple M2 through Metal. SW is SwiftShader. Phone is a Pixel 7 emulation with the CPU throttled 4×.

| Scenario | Desktop GPU | Phone GPU | Desktop SW | Phone SW |
|---|---|---|---|---|
| Own morph, ×1 / ×10 / ×50 | 60 | 60 / 60 / 53 (12% of frames over budget) | 48 / 44 / 38 | 31 / 27 / 21 |
| flubber, ×1 / ×10 / ×50 | 60 | 60 / 59 / 43 (35% of frames over budget) | 48 / 45 / 35 | 28 / 29 / 23 |
| Crossfade, ×50 | 60 | 60 | 37 | 24 |
| Routes (ribbon, segments, gradient), at 1× and 2×, with pan and zoom | 60 | 60 | 38–50 | 19–29 |
| Pulses, 21 at once: HTML / feature-state / setData | 60 | 60 | 52 / 40 / 38 | 46 / 20 / 18 |

- **Re-tiling is the limit, not JS.**
  - JS takes 1.4 ms or less per frame.
  - With 50 territories on the phone, `setData` runs about 40 times a second, but only 3–5 re-tiles land, so the border steps.
- **Precompute per pair**:

  | | Desktop | Phone |
  |---|---|---|
  | Own | 0.3–0.8 ms | 0.7–2.9 ms |
  | flubber, Persia | 285 ms | 1.2 s |
  | flubber, Macedon → Alexander | 384 ms | 1.7 s |

- **Twisted frames, out of 21**:

  | Pair | Own | flubber |
  |---|---|---|
  | Persia | 0 | 19 |
  | Macedon → Alexander | 6 (small) | 16 (worst frame: 76 crossings) |

  flubber has no polygon matching and no holes support, so we would have had to write those anyway.
- **Projection:** lon/lat and Mercator midpoints differ by under about 10 px at zoom 5, so interpolate in lon/lat.
- **flubber's cost:** 20.6 KB gzipped, plus six transitive dependencies.

## Design questions for Bob (answered 2026-10-17)
1. **When a border morph plays.** The proposal was a pure function of the year: 0.7 years long, which is 1 s at 1×, centred on the snapshot's start year and capped at the gap between snapshots. The alternatives were to end at the date or to start at it. Bob chose **centred**.
2. **Routes draw too fast to read.** At 0.7 years a second, a route draws in 0.06–0.4 s, and its name and size show for under a second. Bob chose **to slow the year while a route draws**.
3. **Seen after the spike:** in the ribbon filmstrip, a sharp turn flares into a wedge near the heel of Italy, so ribbon corners need a miter limit.

## Risks
- **Pinch zoom:** pixel-width ribbons lag a frame or two. This wasn't measured on real touch hardware.
- **Smoothed sea routes:** Chaikin smoothing may clip a coast slightly.
- **Strict hosting:** a CSP without `worker-src blob:` stops the map.
- **Made-up test shapes:** the poleis and Macedon at 400 BCE are synthetic, because the dataset has no Macedon at that date.
