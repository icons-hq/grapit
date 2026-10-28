import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecentPerformances, readRecentPerformances, rememberPerformance } from '../use-ticket-library';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
describe('Recent performances privacy and persistence',()=>{
  beforeEach(()=>{localStorage.clear();vi.useRealTimers();});
  it('deduplicates and caps history at 24 public performance IDs',()=>{
    for(let n=0;n<30;n++)rememberPerformance(id(n));
    rememberPerformance(id(10));
    const rows=readRecentPerformances();
    expect(rows).toHaveLength(24);expect(rows[0]?.id).toBe(id(10));
    expect(rows.filter(row=>row.id===id(10))).toHaveLength(1);
    expect(Object.keys(rows[0]!)).toEqual(['id','viewedAt']);
  });
  it('drops malformed and expired data and supports clearing history',()=>{
    const now=Date.now();
    localStorage.setItem('grabit:recent-performances:v1',JSON.stringify([{id:id(1),viewedAt:now-31*86400000},{id:'bad',viewedAt:now},{id:id(2),viewedAt:now}]));
    expect(readRecentPerformances(now).map(row=>row.id)).toEqual([id(2)]);
    clearRecentPerformances();expect(readRecentPerformances()).toEqual([]);
    localStorage.setItem('grabit:recent-performances:v1','not json');
    expect(readRecentPerformances()).toEqual([]);
  });
});
