import type { Citation, Dimension, Source, TimelineDoc } from '../model/types';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

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

export const DIMENSION_LABEL: Record<Dimension, string> = {
  political: 'Political', economic: 'Economic', social: 'Social', technological: 'Technological', intellectual: 'Intellectual', religious: 'Religious',
};

/** Each dimension's pigment (`--pig-…`); umber for none. */
export const PIGMENT: Record<Dimension | 'none', string> = {
  political: 'lapis', economic: 'ochre', social: 'madder', technological: 'verdigris', intellectual: 'indigo', religious: 'cinnabar', none: 'umber',
};

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
