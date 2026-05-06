import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  CONSENT_ITEM_KEYS,
  REQUIRED_CONSENT_ITEM_KEYS,
  type ConsentCaptureItem,
  type ConsentSourceFlow,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { consentAuditLogs, consentItems } from '../../database/schema/index.js';

export const UNDER_14_BLOCK_MESSAGE = '만 14세 미만은 가입할 수 없습니다';
export const CROSS_BORDER_REQUIRED_MESSAGE =
  '국외이전 동의가 필요합니다. 동의하지 않으면 가입 또는 팬미팅 예매를 진행할 수 없습니다.';

export interface ConsentRequestMeta {
  ipAddress: string;
  userAgent?: string;
}

export interface ConsentCaptureRequest {
  birthDate: string;
  items: ConsentCaptureItem[];
  sourceFlow: ConsentSourceFlow;
  capturedAt?: string;
}

type ConsentItemRow = typeof consentItems.$inferSelect;

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
  ): Promise<void> {
    const capturedAt = dto.capturedAt ? new Date(dto.capturedAt) : new Date();
    this.assertAgeAllowed(dto.birthDate, capturedAt);
    await this.assertRequiredConsents(dto);

    const activeItems = await this.db
      .select()
      .from(consentItems)
      .where(eq(consentItems.isActive, true));

    const activeItemByKeyVersionLocale = new Map(
      activeItems.map((item) => [
        this.itemSignature(item.key, item.version, item.locale),
        item,
      ]),
    );

    const auditRows = dto.items.map((item) => {
      const activeItem = activeItemByKeyVersionLocale.get(
        this.itemSignature(item.key, item.version, item.language),
      );

      if (!activeItem) {
        throw new BadRequestException(`${item.key} consent item is not active`);
      }

      return {
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
      };
    });

    if (auditRows.length > 0) {
      await this.db.insert(consentAuditLogs).values(auditRows);
    }
  }

  async assertRequiredConsents(dto: Pick<ConsentCaptureRequest, 'items'>): Promise<void> {
    const itemsByKey = new Map(dto.items.map((item) => [item.key, item]));
    const crossBorder = itemsByKey.get('cross_border_transfer');
    if (!crossBorder?.accepted) {
      throw new BadRequestException(CROSS_BORDER_REQUIRED_MESSAGE);
    }

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
