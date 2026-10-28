import { describe, expect, it } from 'vitest';
import { getCatalogOptions } from './catalog-query';
describe('Browser catalog queries',()=>{
  it('does not send invalid URL values into the API',()=>{
    expect(getCatalogOptions(new URLSearchParams('genre=unknown&region=unknown&sort=bad&page=999999&dateFrom=2026-02-30'))).toMatchObject({genre:undefined,region:undefined,sort:'latest',page:1000,dateFrom:undefined});
  });
  it('keeps supported filters and real leap days',()=>{
    expect(getCatalogOptions(new URLSearchParams('genre=musical&status=upcoming&region=서울&sort=opening&dateFrom=2028-02-29'))).toMatchObject({genre:'musical',status:'upcoming',region:'서울',sort:'opening',dateFrom:'2028-02-29'});
  });
  it('rejects malformed venue IDs even when their overall length matches a UUID',()=>{
    expect(getCatalogOptions(new URLSearchParams(`venueId=00000000-${'-'.repeat(27)}`)).venueId).toBeUndefined();
    expect(getCatalogOptions(new URLSearchParams('venueId=00000000-0000-4000-8000-000000000001')).venueId).toBe('00000000-0000-4000-8000-000000000001');
  });
});
