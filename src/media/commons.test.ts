import { describe, expect, it } from 'vitest';
import { buildSearchUrl, parseSearchResponse, stripHtml } from './commons';

describe('Commons search', () => {
  it('builds an anonymous CORS search URL for files', () => {
    const url = new URL(buildSearchUrl('Rosetta Stone'));
    expect(url.searchParams.get('origin')).toBe('*');
    expect(url.searchParams.get('gsrnamespace')).toBe('6');
    expect(url.searchParams.get('gsrsearch')).toBe('Rosetta Stone filetype:bitmap');
  });

  it('parses results in rank order with credit and license, skipping non-images', () => {
    const json = {
      query: {
        pages: {
          '2': { title: 'File:B.pdf', index: 2, imageinfo: [{ url: 'u', descriptionurl: 'd', mime: 'application/pdf' }] },
          '1': {
            title: 'File:Rosetta Stone.jpg',
            index: 1,
            imageinfo: [{
              url: 'https://upload.wikimedia.org/full.jpg',
              thumburl: 'https://upload.wikimedia.org/640.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Rosetta_Stone.jpg',
              mime: 'image/jpeg',
              extmetadata: {
                Artist: { value: '<a href="x">Hans Hillewaert</a>' },
                LicenseShortName: { value: 'CC BY-SA 4.0' },
                ImageDescription: { value: 'The <i>Rosetta Stone</i> &amp; its inscriptions' },
              },
            }],
          },
        },
      },
    };
    const [r, ...rest] = parseSearchResponse(json);
    expect(rest).toEqual([]);
    expect(r).toMatchObject({
      title: 'Rosetta Stone',
      thumbUrl: 'https://upload.wikimedia.org/640.jpg',
      credit: 'Hans Hillewaert',
      license: 'CC BY-SA 4.0',
      description: 'The Rosetta Stone & its inscriptions',
    });
  });

  it('copes with empty responses', () => {
    expect(parseSearchResponse({})).toEqual([]);
    expect(stripHtml('')).toBeUndefined();
  });
});
