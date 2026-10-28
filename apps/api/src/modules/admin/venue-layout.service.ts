import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { createVenueLayoutSchema, type CreateVenueLayoutInput, type VenueLayoutDetail,
  type VenueLayoutSummary } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { venues, venueLayouts, venueLayoutFloors, venueLayoutSections, venueLayoutSeats } from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';
import type { AdminEventMutationContext } from './admin.service.js';
import { PerformanceIntakeService } from './performance-intake.service.js';

/** Immutable venue geometry. Performances pin a version and assign their own prices. */
@Injectable()
export class VenueLayoutService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly audit: AdminAuditService,
    private readonly intake: PerformanceIntakeService,
  ) {}

  async list(venueName: string): Promise<VenueLayoutSummary[]> {
    if (!venueName.trim()) return [];
    const rows = await this.db.select({
      id: venueLayouts.id, venueId: venueLayouts.venueId, venueName: venues.name,
      layoutName: venueLayouts.layoutName, version: venueLayouts.version, createdAt: venueLayouts.createdAt,
      totalSeats: sql<number>`(select count(*)::int from venue_layout_seats s where s.layout_id = ${venueLayouts.id})`,
      floorCount: sql<number>`(select count(*)::int from venue_layout_floors f where f.layout_id = ${venueLayouts.id})`,
    }).from(venueLayouts).innerJoin(venues, eq(venues.id, venueLayouts.venueId))
      .where(and(eq(venues.name, venueName.trim()), eq(venueLayouts.isTemplate, true)))
      .orderBy(asc(venueLayouts.layoutName), desc(venueLayouts.version)).limit(100);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async get(id: string, db: DrizzleDB = this.db): Promise<VenueLayoutDetail> {
    const [layout] = await db.select({
      id: venueLayouts.id, venueId: venueLayouts.venueId, venueName: venues.name,
      layoutName: venueLayouts.layoutName, version: venueLayouts.version, createdAt: venueLayouts.createdAt,
    }).from(venueLayouts).innerJoin(venues, eq(venues.id, venueLayouts.venueId))
      .where(and(eq(venueLayouts.id, id), eq(venueLayouts.isTemplate, true)));
    if (!layout) throw new NotFoundException('공연장 좌석 템플릿을 찾을 수 없습니다.');
    const floors = await db.select().from(venueLayoutFloors).where(eq(venueLayoutFloors.layoutId, id))
      .orderBy(asc(venueLayoutFloors.sortOrder), asc(venueLayoutFloors.floorKey));
    const seatMaps = floors.map((floor) => ({
      venueLayoutId: layout.id, floorKey: floor.floorKey, floorLabel: floor.floorLabel,
      sortOrder: floor.sortOrder, svgUrl: floor.svgUrl!, seatConfig: floor.seatConfig,
      totalSeats: floor.seatConfig?.tiers.reduce((count, tier) => count + tier.seatIds.length, 0) ?? 0,
    }));
    return { ...layout, createdAt: layout.createdAt.toISOString(), seatMaps,
      floorCount: floors.length, totalSeats: seatMaps.reduce((count, floor) => count + floor.totalSeats, 0) };
  }

  async create(value: CreateVenueLayoutInput, context: AdminEventMutationContext): Promise<VenueLayoutDetail> {
    const input = createVenueLayoutSchema.parse(value);
    const tierNames = new Set(input.seatMaps.flatMap((floor) => floor.seatConfig?.tiers.map((tier) => tier.tierName) ?? []));
    this.intake.assertSeatMapConfigsValid(input.seatMaps, tierNames);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as DrizzleDB;
      // Same venue/name writers serialize before resolving the next version.
      // Transaction scope also releases the lock on validation/insert failure.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`venue-layout:${input.venueName}:${input.layoutName}`}, 0))`);
      await tx.insert(venues).values({ name: input.venueName }).onConflictDoNothing({ target: venues.name });
      const [venue] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.name, input.venueName));
      if (!venue) throw new NotFoundException('공연장을 찾을 수 없습니다.');
      const [version] = await tx.select({ next: sql<number>`coalesce(max(${venueLayouts.version}), 0)::int + 1` })
        .from(venueLayouts).where(and(eq(venueLayouts.venueId, venue.id), eq(venueLayouts.layoutName, input.layoutName)));
      const [layout] = await tx.insert(venueLayouts).values({
        venueId: venue.id, layoutName: input.layoutName, version: version!.next,
        isTemplate: true, isActive: true, sourceSvgUrl: input.seatMaps[0]!.svgUrl,
        normalizedSvgUrl: input.seatMaps[0]!.svgUrl,
      }).returning({ id: venueLayouts.id });

      for (const floor of input.seatMaps) {
        const [storedFloor] = await tx.insert(venueLayoutFloors).values({
          layoutId: layout!.id, floorKey: floor.floorKey, floorLabel: floor.floorLabel,
          sortOrder: floor.sortOrder, svgUrl: floor.svgUrl, seatConfig: floor.seatConfig,
        }).returning({ id: venueLayoutFloors.id });
        const sectionBySeat = new Map<string, string>();
        for (const [index, section] of (floor.seatConfig?.sections ?? []).entries()) {
          const [stored] = await tx.insert(venueLayoutSections).values({
            floorId: storedFloor!.id, sectionKey: section.sectionKey, sectionLabel: section.label, sortOrder: index,
          }).returning({ id: venueLayoutSections.id });
          section.seatIds.forEach((seat) => sectionBySeat.set(seat, stored!.id));
        }
        const seats = floor.seatConfig!.tiers.flatMap((tier) => tier.seatIds);
        const seatRows = seats.map((sourceSeatId, index) => {
          const localId = sourceSeatId.includes(':') ? sourceSeatId.slice(sourceSeatId.indexOf(':') + 1) : sourceSeatId;
          const [row, ...numbers] = localId.split('-');
          return { layoutId: layout!.id, floorId: storedFloor!.id, sectionId: sectionBySeat.get(sourceSeatId),
            seatKey: `${floor.floorKey}:${localId}`, sourceSeatId,
            rowLabel: numbers.length ? row : null, seatNumber: numbers.length ? numbers.join('-') : null, sortOrder: index };
        });
        for (let offset = 0; offset < seatRows.length; offset += 1000) {
          await tx.insert(venueLayoutSeats).values(seatRows.slice(offset, offset + 1000));
        }
      }
      const detail = await this.get(layout!.id, tx);
      await this.audit.write({ ...context, action: 'venue.layout.create', resourceType: 'venue_layout',
        resourceId: detail.id, status: 'success', reason: '공연장 좌석 템플릿 새 버전 저장',
        changedFields: ['layoutName', 'version', 'seatMaps'],
        after: { venueId: detail.venueId, layoutName: detail.layoutName, version: detail.version,
          totalSeats: detail.totalSeats, floorCount: detail.floorCount },
      }, tx);
      return detail;
    });
  }
}
