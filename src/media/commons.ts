import { newId } from '../model/doc';
import type { MediaRef } from '../model/types';

/**
 * Wikimedia Commons image search. Runs in the browser (Commons allows
 * anonymous CORS requests with origin=*). Needs a connection; results the user
 * picks are cached by the service worker for offline viewing.
 */
const API = 'https://commons.wikimedia.org/w/api.php';

export interface CommonsResult {
  title: string;
  thumbUrl: string;
  url: string;
  sourceUrl: string;
  credit?: string;
  license?: string;
  description?: string;
}

/** Strip tags and decode the handful of entities Commons metadata uses. */
export function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

export function buildSearchUrl(query: string, limit = 24): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '640',
  });
  return `${API}?${p.toString()}`;
}

interface ApiPage {
  title: string;
  index?: number;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    descriptionurl: string;
    mime?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

export function parseSearchResponse(json: unknown): CommonsResult[] {
  const pages = (json as { query?: { pages?: Record<string, ApiPage> } })?.query?.pages;
  if (!pages) return [];
  return Object.values(pages)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii || (ii.mime && !ii.mime.startsWith('image/'))) return [];
      const md = ii.extmetadata ?? {};
      return [{
        title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        thumbUrl: ii.thumburl ?? ii.url,
        url: ii.thumburl ?? ii.url,
        sourceUrl: ii.descriptionurl,
        credit: stripHtml(md.Artist?.value),
        license: stripHtml(md.LicenseShortName?.value),
        description: stripHtml(md.ImageDescription?.value)?.slice(0, 300),
      }];
    });
}

export async function searchCommons(query: string, signal?: AbortSignal): Promise<CommonsResult[]> {
  const res = await fetch(buildSearchUrl(query), { signal });
  if (!res.ok) throw new Error(`Wikimedia Commons returned ${res.status}. Try again in a moment.`);
  return parseSearchResponse(await res.json());
}

export function resultToMedia(r: CommonsResult): MediaRef {
  return {
    id: newId('md'),
    source: 'commons',
    url: r.url,
    thumbUrl: r.thumbUrl,
    caption: r.description ?? r.title,
    credit: r.credit,
    license: r.license,
    sourceUrl: r.sourceUrl,
  };
}
