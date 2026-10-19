import type { AiTool } from '../client';
import { RELATION_TYPES } from '../../model/doc';
import { LANES, type Category } from '../../model/types';

/** The one tool Claude answers through, built from the doc's own types and ids. */

export const SUBMIT = 'propose_from_highlight';

const QUOTE = { type: 'string', description: 'Words copied exactly from the highlight or its section that show this is true.' };

export function submitTool(categories: Category[]): AiTool {
  return {
    name: SUBMIT,
    description: 'Propose lanes, entries and connections from Bob’s highlight for him to review. Call this once.',
    input_schema: {
      type: 'object',
      properties: {
        lanes: {
          type: 'array',
          description: 'The lane the passage is mostly about first; a second only when the passage plainly changes that too.',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', enum: [...LANES] },
              quote: QUOTE,
            },
            required: ['value', 'quote'],
            additionalProperties: false,
          },
        },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'A short name for this entry, used as a connection end: "e1", "e2".' },
              title: { type: 'string' },
              kind: { type: 'string', enum: ['event', 'span', 'person'], description: 'event: a moment; span: something with a start and an end; person: a life.' },
              start: { type: 'string', description: 'As Bob would type it: "454 BCE", "c. 447 BCE", "1914-07-28".' },
              end: { type: 'string', description: 'For a span: when it ended, in the same form. "" for an event or a person still living.' },
              place: { type: 'string', description: 'Where it happened, by its usual English name. Never coordinates. "" when the passage doesn’t say.' },
              category: { type: 'string', enum: categories.map((c) => c.id), description: `Category ids: ${categories.map((c) => `${c.id} = ${c.label}`).join('; ')}` },
              quote: QUOTE,
              why: { type: 'string', description: 'One sentence for Bob on what this entry adds. Never saved.' },
            },
            required: ['ref', 'title', 'kind', 'start', 'end', 'place', 'category', 'quote', 'why'],
            additionalProperties: false,
          },
        },
        connections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'What acted: an entry id from Bob’s Chronicle, a linked page key, or an entry ref.' },
              to: { type: 'string', description: 'What it acted on, in the same forms.' },
              type: { type: 'string', enum: RELATION_TYPES, description: '"from <type> to", usually caused or influenced.' },
              effect: { type: 'string', description: 'What it did, in one or two lowercase words: funded, weakened, caused, enabled…' },
              quote: QUOTE,
            },
            required: ['from', 'to', 'type', 'effect', 'quote'],
            additionalProperties: false,
          },
        },
      },
      required: ['lanes', 'entries', 'connections'],
    },
  };
}
