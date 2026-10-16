import { describe, expect, it } from 'vitest';
import { dataUrl, pageUrl, searchTrends, yearsLabel, type TrendIndex } from './trendCatalog';

const index: TrendIndex = {
  built: '2026-10-15',
  wbAggregates: ['WLD'],
  items: [
    { s: 'owid', id: 'population', t: 'Population', u: 'people', from: -9999, to: 2023, d: 'Population by country from 10,000 BCE.' },
    { s: 'owid', id: 'population-young', t: 'Population of women aged 15–19', u: 'people', from: 1950, to: 2023 },
    { s: 'owid', id: 'gdp-per-capita-maddison', t: 'GDP per capita', from: 1, to: 2022, d: 'Average economic output per person.' },
    { s: 'wb', id: 'SP.POP.TOTL', t: 'Population, total', k: 'Health', d: 'Total population counts all residents.' },
    { s: 'wb', id: 'SM.POP.TOTL', t: 'International migrant stock, total', k: 'Social Development', d: 'Number of people born in a country other than that in which they live.' },
  ],
};
const ids = (q: string, f = {}) => searchTrends(index, q, f).map((r) => r.id);

describe('searchTrends', () => {
  it('ranks short title matches first and needs every word', () => {
    expect(ids('population')).toEqual(['population', 'SP.POP.TOTL', 'population-young']);
    expect(ids('population women')).toEqual(['population-young']);
    expect(ids('population mars')).toEqual([]);
    expect(ids('  ')).toEqual([]);
  });

  it('matches word starts, descriptions and topics, ignoring case and accents', () => {
    expect(ids('GDP')).toEqual(['gdp-per-capita-maddison']);
    expect(ids('migr')).toEqual(['SM.POP.TOTL']);
    expect(ids('économic output')).toEqual(['gdp-per-capita-maddison']);
    expect(ids('social')).toEqual(['SM.POP.TOTL']);
    // Bob's words match the sources' words.
    expect(ids('immigrants')).toEqual(['SM.POP.TOTL']);
    expect(ids('population female')).toEqual(['population-young']);
  });

  it('filters by source and by how far back the data goes', () => {
    expect(ids('population', { source: 'wb' })).toEqual(['SP.POP.TOTL']);
    expect(ids('population', { before: 1800 })).toEqual(['population']);
    // World Bank data counts as starting in 1960.
    expect(ids('population', { before: 1961 })).toEqual(['population', 'SP.POP.TOTL', 'population-young']);
  });
});

describe('labels and links', () => {
  it('formats year ranges with BCE', () => {
    expect(yearsLabel(index.items[0])).toBe('10000 BCE – 2023');
    expect(yearsLabel(index.items[3])).toBe('Mostly 1960 on');
    expect(yearsLabel({ s: 'owid', id: 'x', t: 'X' })).toBe('');
  });

  it('builds data and page URLs per source', () => {
    expect(dataUrl(index.items[0])).toBe('https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=false');
    expect(dataUrl(index.items[3])).toBe('https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000');
    expect(pageUrl(index.items[3])).toBe('https://data.worldbank.org/indicator/SP.POP.TOTL');
  });
});
