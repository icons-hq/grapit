import { describe, expect, it } from 'vitest';
import { GENRES } from '../types/performance.types';
import { performanceQuerySchema, searchQuerySchema } from './performance.schema';

describe('Ticket catalog query contracts',()=>{
  it.each(GENRES)('accepts %s consistently for browsing and search',genre=>{
    expect(performanceQuerySchema.parse({genre}).genre).toBe(genre);
    expect(searchQuerySchema.parse({q:'show',genre}).genre).toBe(genre);
  });
  it('validates calendar dates, IDs and the bounded query space',()=>{
    expect(performanceQuerySchema.safeParse({dateFrom:'2026-02-30'}).success).toBe(false);
    expect(performanceQuerySchema.safeParse({region:'invalid'}).success).toBe(false);
    expect(performanceQuerySchema.safeParse({ids:'not-a-uuid'}).success).toBe(false);
    const id='00000000-0000-4000-8000-000000000001';
    expect(performanceQuerySchema.parse({ids:id,sort:'opening'}).ids).toEqual([id]);
    expect(performanceQuerySchema.safeParse({ids:Array(51).fill(id)}).success).toBe(false);
    expect(searchQuerySchema.safeParse({q:'show',page:1001}).success).toBe(false);
    expect(searchQuerySchema.safeParse({q:' '.repeat(10)}).success).toBe(false);
  });
});
