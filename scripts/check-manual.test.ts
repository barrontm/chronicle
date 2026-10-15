import { describe, expect, it } from 'vitest';
import { needsManual } from './check-manual.mjs';

describe('check-manual', () => {
  it('asks for the manual when the app changes', () => {
    expect(needsManual(['src/ui/MapView.tsx'])).toBe(true);
    expect(needsManual(['src/ui/MapView.tsx', 'docs/manual.md'])).toBe(false);
  });

  it('ignores tests, notes for Claude and files outside the app', () => {
    expect(needsManual(['src/ui/mapData.test.ts', 'src/model/CLAUDE.md', 'e2e/app.spec.ts', 'ROADMAP.md', 'scripts/screenshots.mjs'])).toBe(false);
  });
});
