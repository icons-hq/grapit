import { describe, expect, it } from 'vitest';

import { COUNTRY_OPTIONS, getCountryLabel } from './countries';

describe('country constants', () => {
  it('provides the complete ISO-3166 alpha-2 country option set', () => {
    expect(COUNTRY_OPTIONS).toHaveLength(249);
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(200);
  });

  it('keeps country codes canonical and unique', () => {
    const codes = COUNTRY_OPTIONS.map((country) => country.value);

    expect(new Set(codes).size).toBe(COUNTRY_OPTIONS.length);
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(codes).not.toContain('OTHER');
    expect(codes).not.toContain('ZZ');
  });

  it('uses English labels for launch-critical countries', () => {
    expect(getCountryLabel('AF')).toBe('Afghanistan');
    expect(getCountryLabel('BR')).toBe('Brazil');
    expect(getCountryLabel('JP')).toBe('Japan');
    expect(getCountryLabel('KR')).toBe('South Korea');
    expect(getCountryLabel('US')).toBe('United States');
    expect(getCountryLabel('ZW')).toBe('Zimbabwe');
  });

  it('falls back to the raw code for unknown runtime values', () => {
    expect(getCountryLabel('XX')).toBe('XX');
  });
});
