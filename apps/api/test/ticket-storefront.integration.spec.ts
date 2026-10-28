import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import type { StartedTestContainer } from 'testcontainers';
import { performanceQuerySchema, searchQuerySchema } from '@grabit/shared';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { PerformanceService } from '../src/modules/performance/performance.service.js';
import { PerformanceController } from '../src/modules/performance/performance.controller.js';
import { CacheService } from '../src/modules/performance/cache.service.js';
import { SearchService } from '../src/modules/search/search.service.js';
import { FavoritesService } from '../src/modules/user/favorites.service.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

// This suite never consumes DATABASE_URL; every write is in its disposable container.
describe('Ticket storefront — real PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let catalog: PerformanceService;
  let search: SearchService;
  let favorites: FavoritesService;
  let seoul: string, busan: string, musical: string, concert: string, hidden: string, artist: string;
  let owner: string, other: string;

  beforeAll(async () => {
    const pg = await startPostgresContainer({database:'ticket_storefront_test'});
    container=pg.container;
    pool=new Pool({host:pg.host,port:pg.port,user:pg.user,password:pg.password,database:pg.database,max:8});
    closePool=createPostgresPoolCleanup(pool);db=drizzle(pool,{schema});
    await migrate(db,{migrationsFolder:'src/database/migrations'});
    const cache=new CacheService({get:vi.fn().mockResolvedValue(null),set:vi.fn().mockResolvedValue('OK'),del:vi.fn()} as never);
    catalog=new PerformanceService(db,cache,{record:vi.fn()} as never);
    search=new SearchService(db);favorites=new FavoritesService(db);
    const venues=await db.insert(schema.venues).values([{name:'Seoul Hall',address:'서울특별시 마포구'},{name:'Busan Hall',address:'부산광역시 해운대구'}]).returning();
    seoul=venues[0]!.id;busan=venues[1]!.id;
    const events=await db.insert(schema.performances).values([
      {title:'catalogqa musical',genre:'musical',venueId:seoul,viewCount:30,publishState:'published',status:'selling',ageRating:'All',startDate:new Date('2099-02-01T15:00:00Z'),endDate:new Date('2099-02-02T14:59:59Z')},
      {title:'catalogqa concert',genre:'concert',venueId:busan,viewCount:20,publishState:'published',status:'selling',ageRating:'All',startDate:new Date('2099-03-01T15:00:00Z'),endDate:new Date('2099-03-02T14:59:59Z')},
      {title:'catalogqa hidden',genre:'musical',venueId:seoul,viewCount:100,publishState:'draft',status:'selling',ageRating:'All',startDate:new Date('2099-02-01'),endDate:new Date('2099-02-28')},
      {title:'catalogqa artist',genre:'artist_celebrity',venueId:seoul,viewCount:10,publishState:'published',status:'upcoming',ageRating:'All',startDate:new Date('2099-02-01'),endDate:new Date('2099-02-28')},
    ]).returning();
    [musical,concert,hidden,artist]=events.map((event)=>event.id) as [string,string,string,string];
    await db.insert(schema.bookingPolicies).values([
      {performanceId:musical,bookingStartsAt:new Date(Date.now()+3600000)},
      {performanceId:artist,bookingStartsAt:new Date(Date.now()+7200000)},
    ]);
    const users=await db.insert(schema.users).values([1,2].map((i)=>({email:`storefront-${i}@example.test`,name:'Test',phone:`0100000000${i}`,gender:'unspecified' as const,birthDate:'1990-01-01'}))).returning();
    owner=users[0]!.id;other=users[1]!.id;
  },120000);
  afterAll(async()=>{await closePool?.();await container?.stop();});

  it('serves all published genres when the genre is omitted, without exposing drafts',async()=>{
    const result=await new PerformanceController(catalog).listPerformances(performanceQuerySchema.parse({sort:'popular'}));
    expect(result.data.map((row)=>row.id)).toEqual([musical,concert,artist]);
    expect(result.total).toBe(3);
    expect(result.data.map((row)=>row.id)).not.toContain(hidden);
    expect((await catalog.findByGenre('concert',performanceQuerySchema.parse({genre:'concert'}))).data.map((row)=>row.id)).toEqual([concert]);
  });
  it('filters by region, venue and inclusive Korea calendar dates before counting and paging',async()=>{
    const result=await catalog.findByGenre(undefined,performanceQuerySchema.parse({region:'서울',dateFrom:'2099-02-02',dateTo:'2099-02-02',sort:'popular',limit:1}));
    expect(result.total).toBe(2);expect(result.totalPages).toBe(2);expect(result.data[0]?.id).toBe(musical);
    const second=await catalog.findByGenre(undefined,performanceQuerySchema.parse({region:'서울',dateFrom:'2099-02-02',dateTo:'2099-02-02',sort:'popular',limit:1,page:2}));
    expect(second.data[0]?.id).toBe(artist);
    expect((await catalog.findByGenre(undefined,performanceQuerySchema.parse({venueId:busan}))).data.map((row)=>row.id)).toEqual([concert]);
    expect((await catalog.findByGenre(undefined,performanceQuerySchema.parse({dateFrom:'2099-04-01',dateTo:'2099-02-01'}))).total).toBe(0);
  });
  it('orders upcoming sales by opening time and applies the same sale boundary to search',async()=>{
    const result=await catalog.findByGenre(undefined,performanceQuerySchema.parse({status:'upcoming',sort:'opening'}));
    expect(result.data.map((row)=>row.id)).toEqual([musical,artist]);
    const found=await search.search(searchQuerySchema.parse({q:'catalogqa',status:'selling',region:'부산',sort:'popular'}));
    expect(found.total).toBe(1);expect(found.data[0]?.id).toBe(concert);
  });
  it('resolves only requested published IDs without exposing unpublished matches',async()=>{
    const result=await catalog.findByGenre(undefined,performanceQuerySchema.parse({ids:`${musical},${hidden}`,ended:true}));
    expect(result.data.map((row)=>row.id)).toEqual([musical]);expect(result.total).toBe(1);
  });
  it('derives venues and counts solely from published performances',async()=>{
    const result=await catalog.getPublicVenues();
    expect(result.find((venue)=>venue.id===seoul)?.performanceCount).toBe(2);
    expect(result.find((venue)=>venue.id===busan)?.performanceCount).toBe(1);
  });
  it('deduplicates concurrent saves and isolates each account’s list and removal',async()=>{
    await Promise.all(Array.from({length:12},()=>favorites.add(owner,musical)));
    expect((await favorites.list(owner)).ids).toEqual([musical]);
    expect((await favorites.list(other)).ids).toEqual([]);
    await favorites.remove(other,musical);
    expect((await favorites.list(owner)).ids).toEqual([musical]);
    await favorites.remove(owner,musical);
    expect((await favorites.list(owner)).ids).toEqual([]);
    await expect(favorites.add(owner,hidden)).rejects.toThrow('공연을 찾을 수 없습니다');
  });
  it('keeps the 200-save limit even when the last two additions arrive together',async()=>{
    const events=await db.insert(schema.performances).values(Array.from({length:201},(_,i)=>({
      id:randomUUID(),title:`limit-${i}`,genre:'concert' as const,publishState:'published' as const,status:'selling' as const,
      ageRating:'All',startDate:new Date('2099-01-01'),endDate:new Date('2099-12-31'),
    }))).returning({id:schema.performances.id});
    await db.insert(schema.performanceFavorites).values(events.slice(0,199).map((event)=>({userId:other,performanceId:event.id})));
    const outcomes=await Promise.allSettled([favorites.add(other,events[199]!.id),favorites.add(other,events[200]!.id)]);
    expect(outcomes.filter((result)=>result.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result)=>result.status==='rejected')).toHaveLength(1);
    expect((await favorites.list(other)).ids).toHaveLength(200);
    await db.delete(schema.users).where(eq(schema.users.id,other));
    expect((await favorites.list(other)).ids).toHaveLength(0);
  });
});
