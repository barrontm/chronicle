# UI notes

- `TimelineView.tsx` is the only user of the timeline renderer (`timeline/`, our own; vis-timeline is gone); `MapView.tsx` the only importer of maplibre-gl. `MapPane` lazy-loads `MapView`. What's on the map for a year is computed in `mapData.ts` (pure, unit-tested); keep logic there, not in `MapView`.
- `Field` ties a label to its control by id: pass the bare `<input>` / `<select>` / `<textarea>` as its child.
- React bubbles events through portals: forms inside `ImagePicker` call `stopPropagation()`.
- One layout: the reader beside the map over the timeline; on a phone (≤ 860 px) the map and timeline are a sheet over the reader (`mapSheet` in `App.tsx`). The classic layout is gone (its saved `chronicle.classicLayout` and `chronicle.view` are ignored).
- MapLibre can't read CSS variables: `MapView` resolves `var(--…)` and re-applies colors on theme change. Map text is HTML markers (no glyph server). Never replace a marker element's `className`; add classes.
- MapLibre's `.maplibregl-map { position: relative }` overrides weaker container rules; size the host with `.map-pane .map-host`.
- Panels live in `panels/`; navigation is the drawer stack in `nav.ts` (`open`, `replace`, `back`, `showOnMap`).
- Per-viewer preferences use `useStored` from `useStored.ts` (localStorage, failures ignored).
- UI that the reader puts inside the article's HTML (the infobox's header) carries `data-ui`, so `textModel.ts` leaves it out of the text that highlights anchor to.
