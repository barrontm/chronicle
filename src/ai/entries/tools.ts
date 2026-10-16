import type { AiTool } from '../client';
import { RELATION_TYPES } from '../../model/doc';
import type { Category } from '../../model/types';

/** Tool schemas for drafting entries, built from the doc's own types and ids. */

export const SEARCH = 'search_wikipedia';
export const SUBMIT = 'propose_entries';

export function searchTool(run: AiTool['run']): AiTool {
  return {
    name: SEARCH,
    description: 'Search English Wikipedia. Returns up to 10 pages, one per line: key | title | short description. Use the key exactly when proposing an entry.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for, by its usual English name.' } },
      required: ['query'],
    },
    run,
  };
}

export function submitTool(categories: Category[]): AiTool {
  return {
    name: SUBMIT,
    description: 'Propose the entries and connections for Bob to review. Call this once, at the end.',
    input_schema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              page: { type: 'string', description: 'A page key from search_wikipedia results.' },
              category: { type: 'string', enum: categories.map((c) => c.id), description: `Category ids: ${categories.map((c) => `${c.id} = ${c.label}`).join('; ')}` },
              why: { type: 'string', description: 'One sentence on how it fits the request.' },
            },
            required: ['page', 'category', 'why'],
            additionalProperties: false,
          },
        },
        connections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'A proposed page key, or the id of an entry already on the timeline.' },
              to: { type: 'string', description: 'A proposed page key, or the id of an entry already on the timeline.' },
              type: { type: 'string', enum: RELATION_TYPES, description: '"from <type> to": e.g. a battle is part-of its war; a teacher influenced a student.' },
            },
            required: ['from', 'to', 'type'],
            additionalProperties: false,
          },
        },
      },
      required: ['entries', 'connections'],
    },
  };
}
