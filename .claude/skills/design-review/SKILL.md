---
name: design-review
description: Screenshot the Chronicle views a change touched (desktop, phone, dark) as one sheet and critique them against docs/design.md. Use after any user-visible UI, map or timeline change, before committing (CLAUDE.md rule 7).
---

# Design review

Turns rule 7 ("verify visually") into a repeatable check. Review only the views the change touched.

## 1. Take the shots
```bash
npm run build && (npm run preview >/dev/null 2>&1 &)   # skip if a preview is already on :4173
npm run shots -- --only <names> --sheet
```
`<names>` are comma-separated fragments of shot names in `scripts/screenshots.mjs`:
`desktop-empty`, `desktop-timeline`, `desktop-entry`, `desktop-editor`, `desktop-map`, `desktop-split`, `desktop-dark`, `desktop-dark-influences`, `desktop-dark-split`, `phone-timeline`, `phone-influences`, `phone-map`, and `desktop-`/`dark-`/`phone-` + `draw`, `draw-form`, `migration`, `migration-editor`, `trends`, `places`, `help`, `ai-draft`.
Always cover desktop, phone and dark for the touched view. For example `--only map,draw` or `--only trends`.
If the view you changed has no shot, add one to `scripts/screenshots.mjs` (follow the existing flows) before reviewing.

Read only `screenshots/sheet.png`. Open a single full-size shot only to inspect a detail.

## 2. Look harder where a static shot can't show it
For hover, drag, scrubbing the year, playing, or the bottom sheet, use the Playwright MCP server (`.mcp.json`, browser tools `mcp__playwright__*`) against `http://localhost:4173`: import `tests/fixtures/sample-history.json` through the `import-input` file input, then interact and screenshot. Its files go to `screenshots/mcp/` (git-ignored).

## 3. Critique against `docs/design.md`
Check each point and note pass or a concrete problem (what, where, which shot):
- **Palette:** category lanes, pins and territories use their pigment; nothing else competes with it. Limestone/panel/slate tokens in light, `#131b23` family in dark. No hard-coded colors that skip the tokens.
- **Type:** Spectral for titles, notes, axis years and map labels (territories in spaced small caps); Public Sans for controls.
- **Approximate dates:** dashed edge, no "c." prefix.
- **Clipping and overlap:** labels cut off by lanes, panels or the screen edge; labels drawn over each other; lane labels aligned with trend strips.
- **Dark mode contrast:** text, rules, dashed edges and map borders still readable; pigments lightened.
- **Phone (412 wide):** drawer is a bottom sheet; no horizontal scroll; tap targets not cramped; nothing hidden behind the year bar.
- **Map:** parchment land, slate water, faint graticule; Bob's territories at 30% fill with a solid edge, reference borders dashed and quieter; pin names follow the 40-pin rule.
- **Copy:** sentence case, plain words, Bob's point of view, offline states say a connection is needed.

## 4. Act
Fix problems caused by the change, then re-run step 1 for the same views. Report problems that were already there as a short list for Bob instead of fixing them in this ticket.
If the change is intended to alter a view covered by `e2e/visual.spec.ts`, update its baselines (`npx playwright test e2e/visual.spec.ts --update-snapshots`), look at the new baseline images, and commit them with the change.
