import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { performanceFavorites, performances } from '../../database/schema/index.js';

export const MAX_FAVORITE_PERFORMANCES = 200;

@Injectable()
export class FavoritesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async list(userId: string) {
    const rows = await this.db.select({ id: performanceFavorites.performanceId })
      .from(performanceFavorites).where(eq(performanceFavorites.userId, userId))
      .orderBy(desc(performanceFavorites.createdAt), performanceFavorites.performanceId)
      .limit(MAX_FAVORITE_PERFORMANCES);
    return { ids: rows.map((row) => row.id) };
  }

  async add(userId: string, performanceId: string) {
    await this.db.transaction(async (tx) => {
      // Serialize this user's additions so concurrent requests cannot exceed the limit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('performance-favorites'), hashtext(${userId}))`);
      const [performance] = await tx.select({ id: performances.id }).from(performances)
        .where(and(eq(performances.id, performanceId), eq(performances.publishState, 'published'))).limit(1);
      if (!performance) throw new NotFoundException('공연을 찾을 수 없습니다');
      const [existing] = await tx.select({ id: performanceFavorites.performanceId }).from(performanceFavorites)
        .where(and(eq(performanceFavorites.userId, userId), eq(performanceFavorites.performanceId, performanceId))).limit(1);
      if (existing) return;
      const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(performanceFavorites)
        .where(eq(performanceFavorites.userId, userId));
      if ((count?.total ?? 0) >= MAX_FAVORITE_PERFORMANCES) throw new BadRequestException('공연은 최대 200개까지 찜할 수 있습니다');
      await tx.insert(performanceFavorites).values({ userId, performanceId }).onConflictDoNothing();
    });
    return { saved: true };
  }

  async remove(userId: string, performanceId: string) {
    await this.db.delete(performanceFavorites)
      .where(and(eq(performanceFavorites.userId, userId), eq(performanceFavorites.performanceId, performanceId)));
    return { saved: false };
  }
}
