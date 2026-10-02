import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT,
  ADMIN_CONSENT_AUDIT_DEFAULT_WINDOW_DAYS,
  ADMIN_CONSENT_AUDIT_MAX_LIMIT,
  BOOKING_CONSENT_ITEM_KEYS,
  CONSENT_ITEM_KEYS,
  requiredConsentItemKeysFor,
  type ConsentAuditPage,
  type ConsentAuditQuery,
  type ConsentAuditRow,
  type ConsentCaptureItem,
  type ConsentSourceFlow,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { consentAuditLogs, consentItems, users } from '../../database/schema/index.js';

export const UNDER_14_BLOCK_MESSAGE = '만 14세 미만은 가입할 수 없습니다';
/**
 * A required row names a document version (or language) that is not offered any
 * more, typically a page opened before a consent version bump. Reloading picks
 * up the current document.
 */
export const CONSENT_DOCUMENT_OUTDATED_MESSAGE =
  '동의 문서가 갱신되었습니다. 페이지를 새로고침한 뒤 다시 동의해주세요.';

export interface ConsentRequestMeta {
  ipAddress: string;
  userAgent?: string;
}

export interface ConsentCaptureRequest {
  birthDate: string;
  items: ConsentCaptureItem[];
  sourceFlow: ConsentSourceFlow;
}

/**
 * Items may carry their own `sourceFlow` (signup, social completion and booking
 * request schemas all tag every row), which identifies the required set when the
 * caller does not pass one explicitly.
 */
export interface ConsentRequirementInput {
  items: Array<ConsentCaptureItem & { sourceFlow?: ConsentSourceFlow }>;
  sourceFlow?: ConsentSourceFlow;
}

type ConsentItemRow = typeof consentItems.$inferSelect;
type ConsentDb = Pick<DrizzleDB, 'select' | 'insert'>;
const bookingConsentItemKeys = new Set<string>(BOOKING_CONSENT_ITEM_KEYS);

export type ConsentAuditFilters = Omit<ConsentAuditQuery, 'limit'> & { limit?: number };
export type MaskedConsentAuditRow = ConsentAuditRow;

const CONSENT_AUDIT_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const consentAuditCursorSchema = z.object({
  at: z.string().regex(CONSENT_AUDIT_CURSOR_TIMESTAMP),
  id: z.string().uuid(),
});
type ConsentAuditCursor = z.infer<typeof consentAuditCursorSchema>;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ConsentService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async getActiveConsentItems(locale: string): Promise<ConsentItemRow[]> {
    return this.db
      .select()
      .from(consentItems)
      .where(
        and(
          eq(consentItems.locale, locale as ConsentItemRow['locale']),
          eq(consentItems.isActive, true),
        ),
      );
  }

  async captureConsent(
    userId: string,
    dto: ConsentCaptureRequest,
    requestMeta: ConsentRequestMeta,
    db: ConsentDb = this.db,
  ): Promise<void> {
    const capturedAt = new Date();
    this.assertAgeAllowed(dto.birthDate, capturedAt);
    this.assertRequiredAccepted(dto.items, dto.sourceFlow);

    const activeItems = await this.loadActiveItems(db);
    const auditRows = this.resolveCapturedItems(dto.items, dto.sourceFlow, activeItems)
      .map(({ item, activeItem }) => ({
        userId,
        consentItemId: activeItem.id,
        itemKey: item.key,
        itemVersion: item.version,
        language: item.language,
        agreed: item.accepted,
        agreedAt: capturedAt,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
        sourceFlow: dto.sourceFlow,
      }));

    if (auditRows.length > 0) {
      await db.insert(consentAuditLogs).values(auditRows);
    }
  }

  async queryConsentAudit(
    filters: ConsentAuditFilters,
    now: Date = new Date(),
  ): Promise<ConsentAuditPage> {
    const limit = Math.min(
      Math.max(filters.limit ?? ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT, 1),
      ADMIN_CONSENT_AUDIT_MAX_LIMIT,
    );
    const cursor = filters.cursor ? ConsentService.decodeAuditCursor(filters.cursor) : null;
    const predicates: SQL[] = [];

    if (filters.itemKey) {
      predicates.push(eq(consentAuditLogs.itemKey, filters.itemKey));
    }
    if (filters.version) {
      predicates.push(eq(consentAuditLogs.itemVersion, filters.version));
    }
    if (filters.language) {
      predicates.push(eq(consentAuditLogs.language, filters.language));
    }
    if (filters.from) {
      predicates.push(gte(consentAuditLogs.agreedAt, new Date(filters.from)));
    }
    if (filters.to) {
      predicates.push(lte(consentAuditLogs.agreedAt, new Date(filters.to)));
    }
    if (filters.ip) {
      predicates.push(eq(consentAuditLogs.ipAddress, filters.ip));
    }
    if (filters.userId) {
      predicates.push(eq(consentAuditLogs.userId, filters.userId));
    }
    if (filters.email) {
      predicates.push(eq(users.email, filters.email));
    }

    // Without a period or an identity filter the query would walk the whole
    // log; bound it to a recent window the operator can widen explicitly.
    const hasIdentityFilter = Boolean(filters.userId || filters.email || filters.ip);
    let defaultWindowFrom: Date | null = null;
    if (!filters.from && !hasIdentityFilter) {
      const anchor = filters.to ? new Date(filters.to) : now;
      defaultWindowFrom = new Date(anchor.getTime() - ADMIN_CONSENT_AUDIT_DEFAULT_WINDOW_DAYS * DAY_MS);
      predicates.push(gte(consentAuditLogs.agreedAt, defaultWindowFrom));
    }

    if (cursor) {
      // Keyset on (agreed_at, id) descending. The extra `<=` keeps the agreed_at
      // index usable; the cursor keeps microsecond precision from Postgres.
      predicates.push(sql`${consentAuditLogs.agreedAt} <= ${cursor.at}::timestamptz`);
      predicates.push(sql`(${consentAuditLogs.agreedAt} < ${cursor.at}::timestamptz or (${consentAuditLogs.agreedAt} = ${cursor.at}::timestamptz and ${consentAuditLogs.id} < ${cursor.id}::uuid))`);
    }

    const rows = await this.db
      .select({
        id: consentAuditLogs.id,
        itemKey: consentAuditLogs.itemKey,
        version: consentAuditLogs.itemVersion,
        language: consentAuditLogs.language,
        userId: users.id,
        email: users.email,
        phone: users.phone,
        ipAddress: consentAuditLogs.ipAddress,
        timestamp: consentAuditLogs.agreedAt,
        cursorAt: sql<string>`to_char(${consentAuditLogs.agreedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        sourceFlow: consentAuditLogs.sourceFlow,
        accepted: consentAuditLogs.agreed,
      })
      .from(consentAuditLogs)
      .innerJoin(users, eq(consentAuditLogs.userId, users.id))
      .where(and(...predicates))
      .orderBy(desc(consentAuditLogs.agreedAt), desc(consentAuditLogs.id))
      .limit(limit + 1);

    const pageRows = rows.slice(0, limit);
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        itemKey: row.itemKey,
        version: row.version,
        language: row.language,
        maskedUser: {
          id: row.userId,
          email: ConsentService.maskEmail(row.email),
          phone: ConsentService.maskPhone(row.phone),
        },
        maskedIp: ConsentService.maskIp(row.ipAddress),
        timestamp: row.timestamp.toISOString(),
        sourceFlow: row.sourceFlow,
        accepted: row.accepted,
      })),
      nextCursor: rows.length > limit && lastRow
        ? ConsentService.encodeAuditCursor({ at: lastRow.cursorAt, id: lastRow.id })
        : null,
      defaultWindowFrom: defaultWindowFrom?.toISOString() ?? null,
    };
  }

  /**
   * Rejects a request whose required rows are refused, missing, or point at a
   * document version that is not active. Runs before any side effect (seat lock
   * TTL extension, phone token use) so a stale page fails without leaving state.
   */
  async assertRequiredConsents(dto: ConsentRequirementInput): Promise<void> {
    const sourceFlow = dto.sourceFlow ?? ConsentService.inferSourceFlow(dto.items);
    this.assertRequiredAccepted(dto.items, sourceFlow);
    const activeItems = await this.loadActiveItems(this.db);
    this.resolveCapturedItems(dto.items, sourceFlow, activeItems);
  }

  assertAgeAllowed(birthDate: string, at: Date = new Date()): void {
    const birth = new Date(`${birthDate}T00:00:00.000Z`);
    if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) {
      throw new BadRequestException('올바른 생년월일 형식이 아닙니다 (YYYY-MM-DD)');
    }

    const fourteenthBirthday = new Date(birth);
    fourteenthBirthday.setUTCFullYear(fourteenthBirthday.getUTCFullYear() + 14);
    if (at < fourteenthBirthday) {
      throw new ForbiddenException(UNDER_14_BLOCK_MESSAGE);
    }
  }

  static maskEmail(email: string): string {
    const [local = '', domain = ''] = email.split('@');
    if (!domain) return '***';
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  }

  static maskPhone(phone: string): string {
    if (phone.length <= 5) return '***';
    return `${phone.slice(0, 3)}${'*'.repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`;
  }

  static maskIp(ipAddress: string): string {
    if (ipAddress.includes(':')) {
      return `${ipAddress.split(':').slice(0, 4).join(':')}::`;
    }

    const octets = ipAddress.split('.');
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
    }

    return '0.0.0.0';
  }

  static encodeAuditCursor(cursor: ConsentAuditCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  static decodeAuditCursor(value: string): ConsentAuditCursor {
    try {
      return consentAuditCursorSchema.parse(
        JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
      );
    } catch {
      throw new BadRequestException('유효하지 않은 조회 위치입니다. 처음부터 다시 조회해주세요.');
    }
  }

  private static inferSourceFlow(
    items: ConsentRequirementInput['items'],
  ): ConsentSourceFlow | undefined {
    const flows = new Set(items.map((item) => item.sourceFlow));
    if (flows.size !== 1) return undefined;
    return [...flows][0];
  }

  private assertRequiredAccepted(
    items: readonly ConsentCaptureItem[],
    sourceFlow: ConsentSourceFlow | undefined,
  ): void {
    const itemsByKey = new Map(items.map((item) => [item.key, item]));
    for (const key of requiredConsentItemKeysFor(sourceFlow)) {
      const item = itemsByKey.get(key);
      if (!item?.accepted) {
        throw new BadRequestException(`${key} consent is required`);
      }
    }
  }

  private async loadActiveItems(db: Pick<DrizzleDB, 'select'>): Promise<ConsentItemRow[]> {
    return db
      .select()
      .from(consentItems)
      .where(eq(consentItems.isActive, true));
  }

  /**
   * Pairs each submitted row with the active document it names. Booking records
   * only the rows its checkout shows; an unknown optional row is skipped, while
   * an unknown required row means the page is outdated.
   */
  private resolveCapturedItems(
    items: readonly ConsentCaptureItem[],
    sourceFlow: ConsentSourceFlow | undefined,
    activeItems: readonly ConsentItemRow[],
  ): Array<{ item: ConsentCaptureItem; activeItem: ConsentItemRow }> {
    const requiredKeys = new Set<string>(requiredConsentItemKeysFor(sourceFlow));
    const activeItemByKeyVersionLocale = new Map(
      activeItems.map((item) => [
        this.itemSignature(item.key, item.version, item.locale),
        item,
      ]),
    );

    return items.flatMap((item) => {
      if (sourceFlow === 'booking' && !bookingConsentItemKeys.has(item.key)) {
        return [];
      }

      const activeItem = activeItemByKeyVersionLocale.get(
        this.itemSignature(item.key, item.version, item.language),
      );

      if (!activeItem) {
        if (!requiredKeys.has(item.key)) {
          return [];
        }

        throw new BadRequestException(CONSENT_DOCUMENT_OUTDATED_MESSAGE);
      }

      return [{ item, activeItem }];
    });
  }

  private itemSignature(
    key: string,
    version: string,
    locale: string,
  ): string {
    if (!(CONSENT_ITEM_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(`${key} consent item is not supported`);
    }
    return `${key}\u0000${version}\u0000${locale}`;
  }
}
