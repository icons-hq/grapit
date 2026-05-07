import { describe, expect, it } from 'vitest';
import { performanceQuerySchema, searchQuerySchema } from './performance.schema';

describe('performance query schema', () => {
  it('parses ended query strings without JavaScript truthiness coercion', () => {
    expect(performanceQuerySchema.parse({ ended: 'false' }).ended).toBe(false);
    expect(performanceQuerySchema.parse({ ended: 'true' }).ended).toBe(true);
    expect(performanceQuerySchema.parse({}).ended).toBe(false);
    expect(performanceQuerySchema.parse({ ended: '' }).ended).toBe(false);
    expect(() => performanceQuerySchema.parse({ ended: 'yes' })).toThrow();
  });
});

describe('search query schema', () => {
  it('parses ended query strings without JavaScript truthiness coercion', () => {
    expect(searchQuerySchema.parse({ q: 'fanmeet', ended: 'false' }).ended)
      .toBe(false);
    expect(searchQuerySchema.parse({ q: 'fanmeet', ended: 'true' }).ended)
      .toBe(true);
    expect(searchQuerySchema.parse({ q: 'fanmeet' }).ended).toBe(false);
    expect(searchQuerySchema.parse({ q: 'fanmeet', ended: '' }).ended).toBe(false);
    expect(() => searchQuerySchema.parse({ q: 'fanmeet', ended: 'yes' })).toThrow();
  });
});
