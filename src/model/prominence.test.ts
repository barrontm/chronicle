import { describe, expect, it } from 'vitest';
import type { Highlight } from './types';
import { highlightProminence } from './prominence';

const hl = (id: string, usedBy: string[]): Highlight => ({ id, sourceId: 's', text: 't', usedBy, updatedAt: 0 });

describe('highlightProminence (stand-in)', () => {
  it('counts the highlights behind each entry', () => {
    const p = highlightProminence([hl('a', ['pericles']), hl('b', ['pericles', 'war']), hl('c', [])]);
    expect(p('pericles')).toBe(2);
    expect(p('war')).toBe(1);
    expect(p('nobody')).toBe(0);
  });
});
