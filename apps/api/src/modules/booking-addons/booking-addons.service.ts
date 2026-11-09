import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { BookingAddonDefinition, BookingAddonSnapshot, SeatMapConfig } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { consumingAddonHold, countAddonConsumption } from '../../database/booking-addon-inventory.js';
import { canUseAdminBookingBypass, type AdminBookingBypassActor } from '../../common/admin-booking-bypass.js';
import { BookingService } from '../booking/booking.service.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { coalesceFreshReads } from '../../common/fresh-read-batcher.js';

export type AddonActor = AdminBookingBypassActor & { id: string; isEmailVerified?: boolean; isPhoneVerified?: boolean };

@Injectable()
export class BookingAddonsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingAddonsService.name);
  private readonly readInventory = coalesceFreshReads((id: string) => this.loadInventory(id));
  private unsubscribeSeatUpdates?: () => void;
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly booking: BookingService, private readonly gateway: BookingGateway,
    private readonly featureFlags: FeatureFlagsService) {}

  onModuleInit() {
    this.unsubscribeSeatUpdates = this.gateway.onSeatUpdate((showtimeId, _seatId, status) => {
      if (status === 'locked') return;
      // The seat event follows the committed payment/release/refund. Send one
      // shared counter snapshot instead of making every viewer query the DB.
      void this.readInventory(showtimeId).then((inventory) => this.publishStock(inventory))
        .catch(() => this.logger.warn(`Add-on counters could not be published. showtimeId=${showtimeId}`));
    });
  }

  onModuleDestroy() { this.unsubscribeSeatUpdates?.(); }

  async snapshot(showtimeId: string, actor: AddonActor, adminConfigurationRead = false): Promise<BookingAddonSnapshot> {
    const context = await this.db.execute(sql`SELECT p.publish_state FROM showtimes s
      JOIN performances p ON p.id = s.performance_id WHERE s.id = ${showtimeId}`);
    if (!context.rows[0] || (context.rows[0]['publish_state'] !== 'published' && !adminConfigurationRead && !canUseAdminBookingBypass(actor))) {
      throw new NotFoundException('공연을 찾을 수 없습니다.');
    }
    const inventory = await this.readInventory(showtimeId);
    const mine = await this.db.execute(sql`SELECT h.addon_id, h.seat_key, h.unit_index, h.price, h.display_copy, h.expires_at
      FROM booking_addon_holds h JOIN booking_addons a ON a.id = h.addon_id
      WHERE a.showtime_id = ${showtimeId} AND h.user_id = ${actor.id} AND h.reservation_id IS NULL
      AND h.expires_at > clock_timestamp() ORDER BY h.addon_id, h.seat_key, h.unit_index`);
    return { ...inventory, selections: mine.rows.map((r) => ({ addonId: String(r['addon_id']), seatKey: String(r['seat_key']),
      unitIndex: Number(r['unit_index']),
      price: Number(r['price']), displayCopy: r['display_copy'] as BookingAddonDefinition['displayCopy'],
      expiresAt: new Date(String(r['expires_at'])).toISOString() })) };
  }

  private async loadInventory(showtimeId: string): Promise<Omit<BookingAddonSnapshot, 'selections'>> {
    const result = await this.db.execute(sql`SELECT a.*,
      (extract(epoch FROM statement_timestamp()) * 1000000)::bigint AS snapshot_revision,
      (SELECT count(*)::int FROM booking_addon_holds h
        LEFT JOIN reservations r ON r.id = h.reservation_id
        LEFT JOIN ticket_items ti ON ti.reservation_id = h.reservation_id AND ti.seat_key = h.seat_key
        WHERE h.addon_id = a.id AND ${consumingAddonHold}) AS used,
      (SELECT count(*)::int FROM booking_addon_holds h JOIN reservations r ON r.id = h.reservation_id
        JOIN ticket_items ti ON ti.reservation_id = h.reservation_id AND ti.seat_key = h.seat_key
        WHERE h.addon_id = a.id AND r.status = 'CONFIRMED' AND ti.status IN ('active', 'cancellation_pending')) AS sold,
      (SELECT min(expires_at) FROM booking_addon_holds h WHERE h.addon_id = a.id
        AND reservation_id IS NULL AND expires_at > clock_timestamp()) AS next_expiry
      FROM booking_addons a WHERE a.showtime_id = ${showtimeId} ORDER BY a.sort_order, a.id`);
    const dates = result.rows.map((r) => r['next_expiry']).filter(Boolean).map((d) => new Date(String(d)).getTime());
    const revision = Number(result.rows[0]?.['snapshot_revision'] ?? Date.now() * 1000);
    return {
      showtimeId, revision, generatedAt: new Date(revision / 1000).toISOString(), nextExpiryAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      addons: result.rows.map((r) => ({ id: String(r['id']), identity: String(r['identity']),
        displayCopy: r['display_copy'] as BookingAddonDefinition['displayCopy'], price: Number(r['price']),
        capacity: Number(r['capacity']), maxPerTicket: Number(r['max_per_ticket']), eligibleTierNames: r['eligible_tier_names'] as string[],
        active: Boolean(r['active']), sortOrder: Number(r['sort_order']),
        available: Math.max(0, Number(r['capacity']) - Number(r['used'])),
        held: Number(r['used']) - Number(r['sold']), sold: Number(r['sold']) })),
    };
  }

  private async publishStock(snapshot: Omit<BookingAddonSnapshot, 'selections'>) {
    if (!snapshot.addons.length) return;
    await this.gateway.publishAddonStockChanged(snapshot.showtimeId, {
      showtimeId: snapshot.showtimeId, revision: snapshot.revision!, generatedAt: snapshot.generatedAt,
      nextExpiryAt: snapshot.nextExpiryAt,
      stocks: snapshot.addons.map(({ id, available, held, sold, capacity, active }) => ({ id, available, held, sold, capacity, active })),
    });
  }

  async setHold(showtimeId: string, addonId: string, seatKey: string, selected: boolean, actor: AddonActor, unitIndex = 1) {
    if (!Number.isInteger(unitIndex) || unitIndex < 1 || unitIndex > 10) throw new BadRequestException('유효하지 않은 애드온 수량입니다.');
    this.featureFlags.assertBookingEnabled(actor);
    if (!actor.isEmailVerified || !actor.isPhoneVerified) throw new ForbiddenException('이메일 인증과 휴대폰 인증을 완료해야 예매할 수 있습니다.');
    await this.booking.assertShowtimeBookingOpen(showtimeId, { ...actor, role: actor.role ?? undefined });
    let expiresAt: number | null = null;
    let tierName: string | undefined;
    if (selected) {
      await this.booking.assertOwnedSeatLocks(actor.id, showtimeId, [seatKey]);
      const locks = await this.booking.getMyLocks(actor.id, showtimeId);
      expiresAt = locks.expiresAt;
      if (!locks.seatIds.includes(seatKey) || !expiresAt || expiresAt <= Date.now() + 1000) throw new ConflictException('좌석 선점이 만료되었습니다.');
      const maps = await this.db.execute(sql`SELECT sm.floor_key, sm.seat_config FROM seat_maps sm
        JOIN showtimes s ON s.performance_id = sm.performance_id WHERE s.id = ${showtimeId}`);
      const [floorKey, localId] = seatKey.split(':');
      const config = maps.rows.find((r) => r['floor_key'] === floorKey)?.['seat_config'] as SeatMapConfig | undefined;
      tierName = config?.tiers.find((t) => t.seatIds.includes(localId ?? ''))?.tierName;
      if (!tierName) throw new ConflictException('좌석 등급을 확인할 수 없습니다.');
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
      const result = await tx.execute(sql`SELECT * FROM booking_addons WHERE id = ${addonId} AND showtime_id = ${showtimeId} FOR UPDATE`);
      const addon = result.rows[0];
      if (!addon) throw new NotFoundException('애드온을 찾을 수 없습니다.');
      if (!selected) {
        await tx.execute(sql`DELETE FROM booking_addon_holds WHERE addon_id = ${addonId}
          AND user_id = ${actor.id} AND seat_key = ${seatKey} AND unit_index = ${unitIndex} AND reservation_id IS NULL`);
        return;
      }
      if (unitIndex > Number(addon['max_per_ticket'])) throw new BadRequestException('티켓당 구매 가능한 애드온 수량을 초과했습니다.');
      if (!addon['active'] || !(addon['eligible_tier_names'] as string[]).includes(tierName!)) throw new ForbiddenException('해당 좌석 등급에서 구매할 수 없는 애드온입니다.');
      // Serialize against seat release, which clears unbound holds under the same product locks.
      await this.booking.assertOwnedSeatLocks(actor.id, showtimeId, [seatKey]);
      await tx.execute(sql`DELETE FROM booking_addon_holds WHERE addon_id = ${addonId} AND reservation_id IS NULL AND expires_at <= clock_timestamp()`);
      const existing = await tx.execute(sql`SELECT id FROM booking_addon_holds WHERE addon_id = ${addonId}
        AND user_id = ${actor.id} AND seat_key = ${seatKey} AND unit_index = ${unitIndex} AND reservation_id IS NULL`);
      if (existing.rows.length) return;
      if (await countAddonConsumption(tx, addonId) >= Number(addon['capacity'])) throw new ConflictException('한정 애드온 수량이 모두 선점되거나 판매되었습니다.');
      await tx.execute(sql`INSERT INTO booking_addon_holds(addon_id,user_id,seat_key,unit_index,expires_at,price,display_copy)
        VALUES (${addonId},${actor.id},${seatKey},${unitIndex},${new Date(expiresAt!).toISOString()}::timestamptz,${Number(addon['price'])},${JSON.stringify(addon['display_copy'])}::jsonb)`);
    });
    const snapshot = await this.snapshot(showtimeId, actor);
    await this.publishStock(snapshot);
    return snapshot;
  }

  async save(showtimeId: string, input: BookingAddonDefinition, actor: AddonActor) {
    const maxPerTicket = input.maxPerTicket ?? 1;
    if (!Number.isInteger(maxPerTicket) || maxPerTicket < 1 || maxPerTicket > 10) throw new BadRequestException('유효하지 않은 티켓당 애드온 한도입니다.');
    await this.db.transaction(async (tx) => {
      // Serialize create and edit with other configuration writes for this showtime.
      const show = await tx.execute(sql`SELECT id FROM showtimes WHERE id = ${showtimeId} FOR UPDATE`);
      if (!show.rows.length) throw new NotFoundException('회차를 찾을 수 없습니다.');
      const tiers = await tx.execute(sql`SELECT pt.tier_name FROM price_tiers pt JOIN showtimes s ON s.performance_id = pt.performance_id
        WHERE s.id = ${showtimeId}`);
      if (input.eligibleTierNames.some((name) => !tiers.rows.some((row) => row['tier_name'] === name))) {
        throw new BadRequestException('공연에 등록된 가격 등급만 지정할 수 있습니다.');
      }
      const previous = await tx.execute(sql`SELECT * FROM booking_addons WHERE showtime_id = ${showtimeId} AND identity = ${input.identity} FOR UPDATE`);
      const old = previous.rows[0];
      if (old) {
        const used = await countAddonConsumption(tx, String(old['id']));
        if (input.capacity < used) throw new ConflictException('선점·판매 수량보다 재고를 줄일 수 없습니다.');
        if (used > 0 && (Number(old['price']) !== input.price || JSON.stringify(old['eligible_tier_names']) !== JSON.stringify(input.eligibleTierNames))) {
          throw new ConflictException('선점·판매 중인 애드온의 가격이나 대상 등급은 변경할 수 없습니다.');
        }
        const beyondLimit = await tx.execute(sql`SELECT 1 FROM booking_addon_holds h
          LEFT JOIN reservations r ON r.id = h.reservation_id
          LEFT JOIN ticket_items ti ON ti.reservation_id = h.reservation_id AND ti.seat_key = h.seat_key
          WHERE h.addon_id = ${String(old['id'])} AND h.unit_index > ${maxPerTicket} AND ${consumingAddonHold} LIMIT 1`);
        if (beyondLimit.rows.length) throw new ConflictException('선점·구매한 수량보다 티켓당 애드온 한도를 줄일 수 없습니다.');
      }
      await tx.execute(sql`INSERT INTO booking_addons(showtime_id,identity,display_copy,price,capacity,max_per_ticket,eligible_tier_names,active,sort_order)
        VALUES (${showtimeId},${input.identity},${JSON.stringify(input.displayCopy)}::jsonb,${input.price},${input.capacity},${maxPerTicket},${JSON.stringify(input.eligibleTierNames)}::jsonb,${input.active},${input.sortOrder})
        ON CONFLICT(showtime_id,identity) DO UPDATE SET display_copy=excluded.display_copy,price=excluded.price,
        capacity=excluded.capacity,max_per_ticket=excluded.max_per_ticket,eligible_tier_names=excluded.eligible_tier_names,active=excluded.active,sort_order=excluded.sort_order,updated_at=now()`);
      await tx.execute(sql`INSERT INTO admin_audit_logs(actor_user_id,action,resource_type,resource_id,status,reason,masked_before_snapshot,masked_after_snapshot)
        VALUES (${actor.id},'event.update','showtime',${showtimeId},'success','유료 애드온 설정',${JSON.stringify(old ?? {})}::jsonb,${JSON.stringify(input)}::jsonb)`);
    });
    await this.gateway.publishAddonStockChanged(showtimeId);
    return this.snapshot(showtimeId, actor, true);
  }
}
