import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  AUDIENCE_CONSENT_VERSION,
  type AudienceOverview, type AudiencePerformance, type AudiencePreferences, type AudiencePreferencesInput,
  type AudienceProfile, type AudienceProfilesQuery, type AudienceProfileSummary, type AudienceTag, type AudienceTagInput,
} from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { ANALYTICS_DB } from './analytics-database.module.js';
import { summarizeInterests, type InterestObservation } from './audience-interest.js';

const activeProfile = sql`p.expires_at > now() and p.consent_version = ${AUDIENCE_CONSENT_VERSION} and u.account_status = 'active' and u.role = 'user'`;
const selectedTags = sql`coalesce((select jsonb_agg(ut.tag_id order by t.slug) from audience_user_tags ut join audience_tags t on t.id=ut.tag_id and t.active where ut.user_id=p.user_id),'[]'::jsonb)`;
const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;
function profileRow(row: Record<string, unknown>): AudienceProfileSummary {
  return { userId: row.user_id as string, name: row.name as string, email: row.email as string,
    tagIds: row.tag_ids as string[], marketingConsent: row.marketing_consent === true,
    updatedAt: iso(row.updated_at)!, expiresAt: iso(row.expires_at)!, behaviorSince: iso(row.behavior_since) };
}

@Injectable()
export class AudienceService {
  constructor(@Inject(ANALYTICS_DB) private readonly db: DrizzleDB) {}

  async tags(includeInactive = false): Promise<AudienceTag[]> {
    const result = await this.db.execute(sql`select id,slug,kind,labels,active from audience_tags where (${includeInactive} or active) order by kind,slug`);
    return result.rows as unknown as AudienceTag[];
  }

  async saveTag(input: AudienceTagInput, actorId: string, id?: string): Promise<AudienceTag> {
    try {
      return await this.db.transaction(async (tx) => {
        const result = id
          ? await tx.execute(sql`update audience_tags set slug=${input.slug},kind=${input.kind},labels=${JSON.stringify(input.labels)}::jsonb,active=${input.active},updated_at=now() where id=${id}::uuid returning id,slug,kind,labels,active`)
          : await tx.execute(sql`insert into audience_tags(slug,kind,labels,active) values(${input.slug},${input.kind},${JSON.stringify(input.labels)}::jsonb,${input.active}) returning id,slug,kind,labels,active`);
        const tag = result.rows[0] as unknown as AudienceTag | undefined;
        if (!tag) throw new NotFoundException('관심 태그를 찾을 수 없습니다');
        await tx.execute(sql`insert into admin_audit_logs(actor_user_id,action,resource_type,resource_id,status,changed_fields)
          values(${actorId}::uuid,'event.update','audience_tag',${tag.id},'success','["labels","kind","active"]'::jsonb)`);
        return tag;
      });
    } catch (error) {
      if ((error as { code?: string; cause?: { code?: string } }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505') throw new ConflictException('이미 사용 중인 태그 코드입니다');
      throw error;
    }
  }

  async performances(): Promise<AudiencePerformance[]> {
    const result = await this.db.execute(sql`select p.id,p.title,p.genre,p.publish_state as "publishState",
      coalesce((select jsonb_agg(tag_id) from audience_performance_tags where performance_id=p.id),'[]'::jsonb) as "tagIds"
      from performances p order by p.created_at desc,p.id limit 500`);
    return result.rows as unknown as AudiencePerformance[];
  }

  async savePerformanceTags(performanceId: string, tagIds: string[], actorId: string) {
    await this.db.transaction(async (tx) => {
      const performance = await tx.execute(sql`select id from performances where id=${performanceId}::uuid for update`);
      if (!performance.rows.length) throw new NotFoundException('공연을 찾을 수 없습니다');
      await this.validateTags(tx, tagIds);
      await tx.execute(sql`delete from audience_performance_tags where performance_id=${performanceId}::uuid`);
      if (tagIds.length) await tx.execute(sql`insert into audience_performance_tags(performance_id,tag_id) values ${sql.join(tagIds.map((id) => sql`(${performanceId}::uuid,${id}::uuid)`), sql`,`)}`);
      await tx.execute(sql`insert into admin_audit_logs(actor_user_id,action,resource_type,resource_id,status,changed_fields)
        values(${actorId}::uuid,'event.update','performance_interest_tags',${performanceId},'success','["tagIds"]'::jsonb)`);
    });
    return { tagIds };
  }

  async preferences(userId: string): Promise<AudiencePreferences> {
    const result = await this.db.execute(sql`select p.*,${selectedTags} as tag_ids,u.marketing_consent from users u
      left join audience_preferences p on p.user_id=u.id and p.expires_at>now() and p.consent_version=${AUDIENCE_CONSENT_VERSION}
      where u.id=${userId}::uuid and u.account_status='active' and u.role='user'`);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('사용 가능한 회원을 찾을 수 없습니다');
    return { tagIds: row.tag_ids as string[], consentVersion: row.consent_version as string | null,
      consentedAt: iso(row.consented_at), updatedAt: iso(row.updated_at), expiresAt: iso(row.expires_at),
      behaviorSince: iso(row.behavior_since), marketingConsent: row.marketing_consent === true };
  }

  async savePreferences(userId: string, input: AudiencePreferencesInput): Promise<AudiencePreferences> {
    await this.db.transaction(async (tx) => {
      await this.lockMember(tx, userId);
      await this.validateTags(tx, input.tagIds, true);
      await tx.execute(sql`insert into audience_preferences(user_id,consent_version,behavior_since,expires_at)
        values(${userId}::uuid,${AUDIENCE_CONSENT_VERSION},case when ${input.useBehavior} then now() else null end,now()+interval '90 days')
        on conflict(user_id) do update set
          consented_at=case when audience_preferences.expires_at>now() and audience_preferences.consent_version=${AUDIENCE_CONSENT_VERSION} then audience_preferences.consented_at else now() end,
          behavior_since=case when not ${input.useBehavior} then null when audience_preferences.expires_at>now() and audience_preferences.consent_version=${AUDIENCE_CONSENT_VERSION} then coalesce(audience_preferences.behavior_since,now()) else now() end,
          consent_version=${AUDIENCE_CONSENT_VERSION},updated_at=now(),expires_at=now()+interval '90 days'`);
      await tx.execute(sql`delete from audience_user_tags where user_id=${userId}::uuid`);
      if (input.tagIds.length) await tx.execute(sql`insert into audience_user_tags(user_id,tag_id) values ${sql.join(input.tagIds.map((id) => sql`(${userId}::uuid,${id}::uuid)`), sql`,`)}`);
      await tx.execute(sql`insert into audience_consent_events(user_id,version,action,use_behavior) values(${userId}::uuid,${AUDIENCE_CONSENT_VERSION},'save',${input.useBehavior})`);
    });
    return this.preferences(userId);
  }

  async withdraw(userId: string) {
    await this.db.transaction(async (tx) => {
      await this.lockMember(tx, userId);
      await tx.execute(sql`delete from audience_preferences where user_id=${userId}::uuid`);
      await tx.execute(sql`insert into audience_consent_events(user_id,version,action,use_behavior) values(${userId}::uuid,${AUDIENCE_CONSENT_VERSION},'withdraw',false)`);
    });
    return { deleted: true };
  }

  async overview(): Promise<AudienceOverview> {
    const result = await this.db.execute(sql`with eligible as materialized (
      select p.user_id,p.behavior_since,u.marketing_consent from audience_preferences p join users u on u.id=p.user_id where ${activeProfile}
    ) select (select count(*)::int from eligible) as "activeProfiles",
      (select count(*)::int from eligible where behavior_since is not null) as "behaviorProfiles",
      (select count(*)::int from eligible where marketing_consent) as "marketingProfiles",
      coalesce((select jsonb_agg(s order by s.members desc,s."tagId") from (
        select ut.tag_id as "tagId",count(*)::int as members,count(*) filter(where e.marketing_consent)::int as "marketingMembers"
        from eligible e join audience_user_tags ut on ut.user_id=e.user_id join audience_tags t on t.id=ut.tag_id and t.active group by ut.tag_id
      ) s),'[]'::jsonb) as segments`);
    return result.rows[0] as unknown as AudienceOverview;
  }

  async profiles(query: AudienceProfilesQuery) {
    const search = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const filter = sql`${activeProfile} and (${!query.search} or u.name ilike ${search} or u.email ilike ${search})
      and (${!query.marketingOnly} or u.marketing_consent)
      ${query.tagId ? sql`and exists(select 1 from audience_user_tags ut join audience_tags t on t.id=ut.tag_id and t.active where ut.user_id=p.user_id and ut.tag_id=${query.tagId}::uuid)` : sql``}`;
    // One statement gives the page and total the same snapshot; no per-member queries.
    const result = await this.db.execute(sql`select
      (select count(*)::int from audience_preferences p join users u on u.id=p.user_id where ${filter}) as total,
      coalesce((select jsonb_agg(r) from (select p.*,u.name,u.email,u.marketing_consent,${selectedTags} as tag_ids
        from audience_preferences p join users u on u.id=p.user_id where ${filter}
        order by p.updated_at desc,p.user_id limit 25 offset ${(query.page - 1) * 25}) r),'[]'::jsonb) as rows`);
    const row = result.rows[0]!;
    return { page: query.page, pageSize: 25, total: row.total as number, rows: (row.rows as Record<string, unknown>[]).map(profileRow) };
  }

  async profile(userId: string): Promise<AudienceProfile> {
    // A single snapshot keeps withdrawal/expiry from leaving a separately cached profile.
    const result = await this.db.execute(sql`with eligible as materialized (
      select p.*,u.name,u.email,u.marketing_consent,${selectedTags} as tag_ids,
        greatest(p.behavior_since,now()-interval '90 days') as observed_since
      from audience_preferences p join users u on u.id=p.user_id where p.user_id=${userId}::uuid and ${activeProfile}
    ), observations as (
      select pt.tag_id,'view' as kind,count(distinct (e.occurred_at at time zone 'Asia/Seoul')::date)::int as count,max(e.occurred_at) as last_at
      from eligible p join analytics_sessions s on s.user_id=p.user_id join analytics_events e on e.session_id=s.id
      join audience_performance_tags pt on pt.performance_id::text=e.props->>'performanceId'
      where p.behavior_since is not null and e.occurred_at>=p.observed_since and e.name='performance_view' group by pt.tag_id
      union all
      select pt.tag_id,'checkout',count(distinct e.session_id)::int,max(e.occurred_at)
      from eligible p join analytics_sessions s on s.user_id=p.user_id join analytics_events e on e.session_id=s.id
      join audience_performance_tags pt on pt.performance_id::text=e.props->>'performanceId'
      where p.behavior_since is not null and e.occurred_at>=p.observed_since and e.name='checkout_start' group by pt.tag_id
      union all
      select pt.tag_id,'favorite',count(*)::int,max(f.created_at) from eligible p join performance_favorites f on f.user_id=p.user_id
      join audience_performance_tags pt on pt.performance_id=f.performance_id
      where p.behavior_since is not null and f.created_at>=p.observed_since group by pt.tag_id
      union all
      select pt.tag_id,'purchase',count(distinct r.id)::int,max(pay.paid_at) from eligible p join reservations r on r.user_id=p.user_id
      join payments pay on pay.reservation_id=r.id join showtimes st on st.id=r.showtime_id join audience_performance_tags pt on pt.performance_id=st.performance_id
      where p.behavior_since is not null and pay.paid_at>=p.observed_since and r.status='CONFIRMED' and pay.status in ('DONE','PARTIAL_CANCELED') group by pt.tag_id
    ) select p.*,coalesce((select jsonb_agg(jsonb_build_object('tagId',o.tag_id,'kind',o.kind,'count',o.count,'lastAt',o.last_at))
      from observations o join audience_tags t on t.id=o.tag_id and t.active),'[]'::jsonb) as observations from eligible p`);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('활성 관심 프로필이 없습니다');
    const observations = (row.observations as InterestObservation[]).map((r) => ({ ...r, lastAt: iso(r.lastAt)! }));
    return { ...profileRow(row), ...summarizeInterests(observations), observedSince: row.behavior_since ? iso(row.observed_since) : null };
  }

  private async validateTags(tx: Pick<DrizzleDB, 'execute'>, ids: string[], perKindLimit = false) {
    if (!ids.length) return;
    const rows = await tx.execute(sql`select id,kind from audience_tags where active and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`,`)}) for share`);
    if (rows.rows.length !== ids.length) throw new BadRequestException('사용할 수 없는 관심 태그가 포함되어 있습니다');
    if (perKindLimit) {
      const counts = new Map<string, number>();
      for (const row of rows.rows) counts.set(row.kind as string, (counts.get(row.kind as string) ?? 0) + 1);
      if ([...counts.values()].some((count) => count > 5)) throw new BadRequestException('질문별로 최대 5개까지 선택할 수 있습니다');
    }
  }

  private async lockMember(tx: Pick<DrizzleDB, 'execute'>, userId: string) {
    const user = await tx.execute(sql`select id from users where id=${userId}::uuid and account_status='active' and role='user' for update`);
    if (!user.rows.length) throw new NotFoundException('사용 가능한 회원을 찾을 수 없습니다');
  }
}
