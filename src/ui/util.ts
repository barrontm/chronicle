import type { Citation, Lane, Source, TimelineDoc } from '../model/types';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

export function formatValue(v: number, unit?: string): string {
  const n = Math.abs(v) >= 10_000 ? compact.format(v) : plain.format(v);
  return unit ? `${n} ${unit}` : n;
}

/** "Barnes, Aristotle: A Very Short Introduction (2000), ch. 1" — short and readable, not a citation style. */
export function formatCitation(source: Source | undefined, c: Citation): string {
  if (!source) return 'Missing source';
  const parts = [source.authors, source.title].filter(Boolean).join(', ');
  const year = source.year ? ` (${source.year})` : '';
  return `${parts}${year}${c.locator ? `, ${c.locator}` : ''}`;
}

export const LANE_LABEL: Record<Lane, string> = {
  politics: 'Politics and law', war: 'War', economy: 'Economy', ideas: 'Philosophy and religion', technology: 'Technology', nature: 'Nature',
};

/** Each lane's pigment (`--pig-…`); umber for none. */
export const PIGMENT: Record<Lane | 'none', string> = {
  politics: 'lapis', war: 'cinnabar', economy: 'ochre', ideas: 'indigo', technology: 'verdigris', nature: 'terre', none: 'umber',
};

/** The lanes in words, in pigment order: "War, Economy". */
export const lanesInWords = (lanes: readonly Lane[] | undefined) => (lanes ?? []).map((l) => LANE_LABEL[l]).join(', ');

export function titleOf(doc: TimelineDoc, id: string): string | undefined {
  return doc.items.find((i) => i.id === id)?.title ?? doc.series.find((s) => s.id === id)?.title ?? doc.territories.find((t) => t.id === id)?.title ?? doc.flows.find((f) => f.id === id)?.title;
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
