import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The timeline is our own renderer: vis-timeline, vis-data and moment left with the switch-over (about 165 KB gzipped). */
const GONE = /from ['"](vis-timeline|vis-data|moment)(\/[^'"]*)?['"]|import ['"](vis-timeline|vis-data|moment)(\/[^'"]*)?['"]/;
const root = fileURLToPath(new URL('../../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx|css)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('the old timeline library', () => {
  it('is imported nowhere', () => {
    const found = sources(join(root, 'src')).filter((p) => GONE.test(readFileSync(p, 'utf8')));
    expect(found).toEqual([]);
  });

  it('is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: object; devDependencies?: object };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => ['vis-timeline', 'vis-data', 'moment'].includes(d))).toEqual([]);
  });
});
