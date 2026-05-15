import { describe, expect, it } from 'vitest';

import { safeCsvCell, safeCsvRow, safeCsvRows } from './csv-export.util.js';

describe('CSV export safety helpers', () => {
  it('quotes every cell and escapes embedded quotes', () => {
    expect(safeCsvCell('plain')).toBe('"plain"');
    expect(safeCsvCell('a "quoted" value')).toBe('"a ""quoted"" value"');
    expect(safeCsvCell(1234)).toBe('"1234"');
    expect(safeCsvCell(null)).toBe('""');
  });

  it.each([
    ['=cmd'],
    ['+cmd'],
    ['-cmd'],
    ['@cmd'],
    ['\t=cmd'],
    ['\r=cmd'],
  ])('neutralizes formula-leading cell %j', (value) => {
    expect(safeCsvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  });

  it('builds safe CSV rows from arbitrary cell values', () => {
    expect(safeCsvRow(['name', '=1+1', 'a,b'])).toBe('"name","\'=1+1","a,b"');
    expect(safeCsvRows([
      ['name', 'amount'],
      ['Alice', '+99000'],
    ])).toBe('"name","amount"\n"Alice","\'+99000"');
  });
});
