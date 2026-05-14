import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, gte, lte, type SQL } from 'drizzle-orm';
import {
  CONSENT_ITEM_KEYS,
  REQUIRED_CONSENT_ITEM_KEYS,
  type ConsentCaptureItem,
  type ConsentItemKey,
  type ConsentSourceFlow,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { consentAuditLogs, consentItems, users } from '../../database/schema/index.js';

export const UNDER_14_BLOCK_MESSAGE = '만 14세 미만은 가입할 수 없습니다';

export interface ConsentRequestMeta {
  ipAddress: string;
  userAgent?: string;
}

export interface ConsentCaptureRequest {
  birthDate: string;
  items: ConsentCaptureItem[];
  sourceFlow: ConsentSourceFlow;
}

type ConsentItemRow = typeof consentItems.$inferSelect;
type ConsentDb = Pick<DrizzleDB, 'select' | 'insert'>;
const requiredConsentItemKeys = new Set<string>(REQUIRED_CONSENT_ITEM_KEYS);

export interface ConsentAuditFilters {
  itemKey?: ConsentItemKey;
  version?: string;
  language?: 'ko' | 'en' | 'th' | 'zh-CN' | 'zh-TW';
  from?: string;
  to?: string;
  ip?: string;
  userId?: string;
  email?: string;
}

export interface MaskedConsentAuditRow {
  itemKey: string;
  version: string;
  language: string;
  maskedUser: {
    id: string;
    email: string;
    phone: string;
  };
  maskedIp: string;
  timestamp: string;
  sourceFlow: string;
  accepted: boolean;
}

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
    await this.assertRequiredConsents(dto);

    const activeItems = await db
      .select()
      .from(consentItems)
      .where(eq(consentItems.isActive, true));

    const activeItemByKeyVersionLocale = new Map(
      activeItems.map((item) => [
        this.itemSignature(item.key, item.version, item.locale),
        item,
      ]),
    );

    const auditRows = dto.items.flatMap((item) => {
      const activeItem = activeItemByKeyVersionLocale.get(
        this.itemSignature(item.key, item.version, item.language),
      );

      if (!activeItem) {
        if (!requiredConsentItemKeys.has(item.key)) {
          return [];
        }

        throw new BadRequestException(`${item.key} consent item is not active`);
      }

      return [{
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
      }];
    });

    if (auditRows.length > 0) {
      await db.insert(consentAuditLogs).values(auditRows);
    }
  }

  async queryConsentAudit(filters: ConsentAuditFilters): Promise<MaskedConsentAuditRow[]> {
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

    const baseQuery = this.db
      .select({
        itemKey: consentAuditLogs.itemKey,
        version: consentAuditLogs.itemVersion,
        language: consentAuditLogs.language,
        userId: users.id,
        email: users.email,
        phone: users.phone,
        ipAddress: consentAuditLogs.ipAddress,
        timestamp: consentAuditLogs.agreedAt,
        sourceFlow: consentAuditLogs.sourceFlow,
        accepted: consentAuditLogs.agreed,
      })
      .from(consentAuditLogs)
      .innerJoin(users, eq(consentAuditLogs.userId, users.id));

    const rows = predicates.length > 0
      ? await baseQuery.where(and(...predicates))
      : await baseQuery;

    return rows.map((row) => ({
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
    }));
  }

  async assertRequiredConsents(dto: Pick<ConsentCaptureRequest, 'items'>): Promise<void> {
    const itemsByKey = new Map(dto.items.map((item) => [item.key, item]));
    for (const key of REQUIRED_CONSENT_ITEM_KEYS) {
      const item = itemsByKey.get(key);
      if (!item?.accepted) {
        throw new BadRequestException(`${key} consent is required`);
      }
    }
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
