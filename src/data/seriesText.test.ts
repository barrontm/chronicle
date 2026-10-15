import { describe, expect, it } from 'vitest';
import { owidCsvUrl, parseCsv, parseOwidCsv, parsePointsText, pointsToText } from './seriesText';

describe('parseCsv', () => {
  it('handles quotes, commas in quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "q"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('parsePointsText', () => {
  it('parses year/value lines, BCE years and separators, and sorts', () => {
    const { points, errors } = parsePointsText('1900, 1,650,000,000\n# comment\n\n500 BCE; 100\n1800\t990');
    expect(errors).toEqual([]);
    expect(points).toEqual([
      { x: -499, v: 100 },
      { x: 1800, v: 990 },
      { x: 1900, v: 1_650_000_000 },
    ]);
  });
  it('reports bad lines by number', () => {
    const { errors } = parsePointsText('1900, 5\nnope\nsoon, 4\n1950, lots');
    expect(errors).toEqual([
      'Line 2: expected "year, value"',
      'Line 3: "soon" isn\'t a date',
      'Line 4: "lots" isn\'t a number',
    ]);
  });
  it('round-trips through pointsToText', () => {
    const pts = [{ x: -499, v: 1 }, { x: 1914, v: 2.5 }];
    expect(parsePointsText(pointsToText(pts)).points).toEqual(pts);
  });
});

describe('Our World in Data', () => {
  const csv = 'Entity,Code,Year,Population (historical)\nWorld,OWID_WRL,-10000,4501152\nWorld,OWID_WRL,1800,984000000\nFrance,FRA,1800,29000000\nWorld,OWID_WRL,1900,\n';
  it('reads entities, indicators and points', () => {
    const t = parseOwidCsv(csv);
    expect(t.entities).toEqual(['France', 'World']);
    expect(t.indicators).toEqual(['Population (historical)']);
    expect(t.pointsFor('World', 'Population (historical)')).toEqual([
      { x: -10000, v: 4501152 },
      { x: 1800, v: 984000000 },
    ]);
  });
  it('collects every country by ISO code for the map, leaving out OWID aggregates', () => {
    const t = parseOwidCsv([
      'Entity,Code,Year,GDP per capita',
      'France,FRA,1820,1809',
      'France,FRA,1900,4500',
      'Germany,DEU,1900,4200',
      'Europe,,1900,4000',
      'World,OWID_WRL,1900,2200',
      'Nowhere,NOW,1900,',
    ].join('\n'));
    expect(t.countriesFor('GDP per capita')).toEqual({
      FRA: [{ x: 1820, v: 1809 }, { x: 1900, v: 4500 }],
      DEU: [{ x: 1900, v: 4200 }],
    });
    expect(parseOwidCsv('Entity,Year,x\nWorld,1900,1').countriesFor('x')).toEqual({});
  });

  it('rejects other CSVs clearly', () => {
    expect(() => parseOwidCsv('a,b\n1,2')).toThrow(/Our World in Data/);
  });
  it('builds CSV URLs from chart links', () => {
    expect(owidCsvUrl('https://ourworldindata.org/grapher/population?tab=chart')).toBe(
      'https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=false',
    );
    expect(() => owidCsvUrl('https://example.com/x')).toThrow(/Our World in Data chart/);
  });
});
