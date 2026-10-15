# UI notes

- `TimelineView.tsx` is the only importer of vis-timeline; `MapView.tsx` the only importer of maplibre-gl. `MapPane` lazy-loads `MapView`. What's on the map for a year is computed in `mapData.ts` (pure, unit-tested); keep logic there, not in `MapView`.
- `Field` ties a label to its control by id: pass the bare `<input>` / `<select>` / `<textarea>` as its child.
- React bubbles events through portals: forms inside `ImagePicker` call `stopPropagation()`.
- vis-timeline label callbacks get moment objects (types say `Date`); the timeline runs in UTC. `setCustomTimeMarker` exists at runtime but is missing from the `Timeline` typings (see the `WithMarker` cast).
- MapLibre can't read CSS variables: `MapView` resolves `var(--…)` and re-applies colors on theme change. Map text is HTML markers (no glyph server). Never replace a marker element's `className`; add classes.
- MapLibre's `.maplibregl-map { position: relative }` overrides weaker container rules; size the host with `.map-pane .map-host`.
- Panels live in `panels/`; navigation is the drawer stack in `nav.ts` (`open`, `replace`, `back`, `showOnMap`).
- Per-viewer preferences use `useStored` in `App.tsx` (localStorage, failures ignored).
