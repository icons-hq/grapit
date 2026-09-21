import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { CreatePerformanceDraftInput, SavePerformanceDraftInput, PerformanceDraft } from '@grabit/shared';
import { createPerformanceSchema } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { performanceDrafts, performances } from '../../database/schema/index.js';
import { AdminService, type AdminEventMutationContext } from './admin.service.js';
import { CatalogFreshnessService } from '../performance/catalog-freshness.service.js';

@Injectable()
export class PerformanceDraftService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly admin: AdminService,
    private readonly freshness: CatalogFreshnessService,
  ) {}

  async create(ownerUserId: string, input: CreatePerformanceDraftInput): Promise<PerformanceDraft> {
    let baseUpdatedAt: Date | null = null;
    if (input.performanceId) {
      const [performance] = await this.db.select().from(performances).where(eq(performances.id, input.performanceId));
      if (!performance) throw new NotFoundException('공연을 찾을 수 없습니다.');
      if (!input.baseUpdatedAt || performance.updatedAt.toISOString() !== input.baseUpdatedAt) {
        throw new ConflictException('공연이 변경되었습니다. 최신 내용을 불러온 뒤 초안을 저장해주세요.');
      }
      baseUpdatedAt = performance.updatedAt;
    }
    const [draft] = await this.db.insert(performanceDrafts).values({ ownerUserId,
      performanceId: input.performanceId ?? null, baseUpdatedAt, data: input.data, step: input.step }).returning();
    return this.map(draft!);
  }

  async list(ownerUserId: string, performanceId?: string): Promise<PerformanceDraft[]> {
    const rows = await this.db.select().from(performanceDrafts).where(and(
      eq(performanceDrafts.ownerUserId, ownerUserId), isNull(performanceDrafts.appliedAt),
      performanceId ? eq(performanceDrafts.performanceId, performanceId) : undefined,
    )).orderBy(desc(performanceDrafts.updatedAt)).limit(100);
    return rows.map((row) => this.map(row));
  }

  async get(id: string, ownerUserId: string): Promise<PerformanceDraft> {
    const [draft] = await this.db.select().from(performanceDrafts).where(and(
      eq(performanceDrafts.id, id), eq(performanceDrafts.ownerUserId, ownerUserId),
    ));
    if (!draft) throw new NotFoundException('초안을 찾을 수 없습니다.');
    return this.map(draft);
  }

  async save(id: string, ownerUserId: string, input: SavePerformanceDraftInput): Promise<PerformanceDraft> {
    const [draft] = await this.db.update(performanceDrafts).set({ data: input.data, step: input.step,
      revision: input.expectedRevision + 1, updatedAt: new Date() }).where(and(
      eq(performanceDrafts.id, id), eq(performanceDrafts.ownerUserId, ownerUserId),
      eq(performanceDrafts.revision, input.expectedRevision), isNull(performanceDrafts.appliedAt),
    )).returning();
    if (!draft) {
      await this.get(id, ownerUserId);
      throw new ConflictException('다른 창에서 초안이 변경되었거나 이미 반영되었습니다. 최신 초안을 다시 열어주세요.');
    }
    return this.map(draft);
  }

  async apply(id: string, expectedRevision: number, context: AdminEventMutationContext): Promise<PerformanceDraft> {
    const result = await this.db.transaction(async (tx) => {
      const [draft] = await tx.select().from(performanceDrafts).where(and(
        eq(performanceDrafts.id, id), eq(performanceDrafts.ownerUserId, context.actorUserId),
      )).for('update');
      if (!draft) throw new NotFoundException('초안을 찾을 수 없습니다.');
      if (draft.revision !== expectedRevision) throw new ConflictException('초안이 변경되었습니다. 최신 초안을 다시 열어주세요.');
      if (draft.appliedAt) return this.map(draft);
      const parsed = createPerformanceSchema.safeParse(draft.data);
      if (!parsed.success) throw new BadRequestException({ message: '필수 정보를 확인해주세요.', errors: parsed.error.flatten().fieldErrors });
      const data = parsed.data;
      let performanceId = draft.performanceId;
      if (performanceId) {
        const [current] = await tx.select().from(performances).where(eq(performances.id, performanceId)).for('update');
        if (!current) throw new NotFoundException('공연을 찾을 수 없습니다.');
        if (!draft.baseUpdatedAt || current.updatedAt.getTime() !== draft.baseUpdatedAt.getTime()) {
          throw new ConflictException('다른 담당자가 공연을 변경했습니다. 초안은 보존되며 최신 공연 내용을 확인한 뒤 다시 작성해주세요.');
        }
        const { publishState: _state, ...update } = data;
        await this.admin.updatePerformance(performanceId, update, context, tx as unknown as DrizzleDB);
      } else {
        const created = await this.admin.createPerformance(data, context, tx as unknown as DrizzleDB);
        performanceId = created.id;
      }
      const [applied] = await tx.update(performanceDrafts).set({ performanceId, appliedAt: new Date(), updatedAt: new Date() })
        .where(eq(performanceDrafts.id, id)).returning();
      return this.map(applied!);
    });
    await this.freshness.invalidatePerformance(result.performanceId ?? undefined);
    return result;
  }

  private map(row: typeof performanceDrafts.$inferSelect): PerformanceDraft {
    return { id: row.id, performanceId: row.performanceId, data: row.data,
      title: typeof row.data.title === 'string' && row.data.title.trim() ? row.data.title : '제목 없는 공연',
      step: row.step, revision: row.revision, baseUpdatedAt: row.baseUpdatedAt?.toISOString() ?? null,
      appliedAt: row.appliedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
  }
}
