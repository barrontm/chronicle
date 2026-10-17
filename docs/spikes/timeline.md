# Spike (a): the timeline renderer

Phase 0, ticket 4, run on 2026-10-17. The code, the demo (`demo.html`, `vis-baseline.html`) and the raw numbers (`results.json`) are on branch `spike/timeline` under `spikes/timeline/`, not merged. Machine: Apple M2, headless Chromium. Each figure is the median of 3 runs of 5 s; "phone" is a Pixel 7 with the CPU throttled 4×.

## Recommendation
Split the renderer into two parts: a pure layout, and a painter that can be swapped. Start with SVG painting, plain Pointer Events (no d3-zoom) and time as decimal years.

- The layout turns entries, window, size and level into a culled list of marks. It takes 0.1–2 ms a frame even with 50,000 entries.
- At 2,000 entries, SVG, canvas and the hybrid all hold 60 fps, so speed doesn't decide the choice.
- SVG wins on CSS theming, crisp text and drag handles that are ordinary elements.
- The hybrid is the fallback if Bob's real phone shows p95 over 16.7 ms.

## Numbers
Each cell gives p95 frame ms, then the share of frames over 16.7 ms in brackets.

| Scenario | SVG | Canvas | Hybrid | vis-timeline |
|---|---|---|---|---|
| Pan, desktop | 16.7 (0) | 16.8 (0) | 16.8 (0) | 16.8 (0) |
| Pan, phone | 16.7 (0) | 16.7 (1) | 16.8 (0) | 16.7 (0) |
| Level transition, phone | 16.8 (0) | 16.8 (4) | 33.3 (6) | n/a |
| Init, desktop / phone | 60 / 137 ms | 34 / 162 ms | 33 / 185 ms | 120 / 431 ms |
| Heap | 9 MB | 5 MB | 5 MB | 15 MB |
| 10,000 entries, phone, widest view | 16.8 (0) | 16.8 (2) | 33.3 (10) | init 4.0 s |
| 50,000 entries, phone | 16.8 (3) | 66.7 (39) | 50 (35) | didn't load in 30 s |

Headless Chromium may draw canvas in software, which would exaggerate the canvas phone figures.

## Findings
- **d3-zoom:** it gives the same results as Pointer Events but covers only 3 of the 5 gestures. It needs `filter`, `wheelDelta` and `constrain` overrides plus a sync layer, and adds 17.5 KB gzipped. The Pointer Events driver is about 90 lines.
- **Deep time:** the ±271k-year limit lifts. Ticks are sensible from −3,000,000 to 2100 ("2.8 million BCE"), and down to days for 3–10 June 1944. There are 10 tests.
- **Bundle:** vis-timeline, vis-data and moment together are 199 KB of JS and 3 KB of CSS, gzipped. The custom renderer is about 18 KB without d3-zoom, so dropping them saves about 165 KB.
- **Accessibility:** a roving model with `aria-activedescendant` and one hidden option node works in every variant. Arrow keys move through entries and lanes.
- **Boundary:** `createTimeline` mirrors today's `TimelineControl`, plus a level, and exposes the same window that `TrendStrips` reads.
- **Drag to change dates:** in SVG it costs about as much as the pan handler. Canvas and the hybrid need a hit test, a ghost mark and a drag mode: a day or two of work.

## Open for Phase 3
- Spans are 19 px tall, under touch size.
- The phone's level-1 vertical list isn't built.
- Spectral SC isn't bundled; era names used Spectral 600.
- `formatAxisYear(0)` returns "1 CE". This is an existing quirk.
- vis-timeline virtualizes too: its costs are init time, heap and bundle size, not pan speed.
