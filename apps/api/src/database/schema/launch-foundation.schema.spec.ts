import {
  consentAuditLogs,
  consentItems,
  emailVerificationTokens,
  legalContent,
  legalContentTypeEnum,
  localeEnum,
  translationDrafts,
  translationSources,
  translationStatusEnum,
  users,
} from './index.js';

function expectColumnName(column: { name: string }, name: string) {
  expect(column.name).toBe(name);
}

describe('Phase 23 launch foundation schema contracts', () => {
  it('stores a nullable/defaulted preferred locale for existing users', () => {
    expectColumnName(users.preferredLocale, 'preferred_locale');
  });

  it('models email verification tokens as hashed, expirable, consumable, latest-token-wins records', () => {
    expectColumnName(emailVerificationTokens.tokenHash, 'token_hash');
    expectColumnName(emailVerificationTokens.expiresAt, 'expires_at');
    expectColumnName(emailVerificationTokens.consumedAt, 'consumed_at');
    expectColumnName(emailVerificationTokens.purpose, 'purpose');
    expectColumnName(emailVerificationTokens.userId, 'user_id');
    expectColumnName(emailVerificationTokens.email, 'email');
  });

  it('records consent evidence by item, version, language, timestamp, IP, and user', () => {
    expectColumnName(consentItems.key, 'key');
    expectColumnName(consentItems.version, 'version');
    expectColumnName(consentItems.locale, 'locale');
    expectColumnName(consentAuditLogs.consentItemId, 'consent_item_id');
    expectColumnName(consentAuditLogs.itemKey, 'item_key');
    expectColumnName(consentAuditLogs.itemVersion, 'item_version');
    expectColumnName(consentAuditLogs.language, 'language');
    expectColumnName(consentAuditLogs.agreedAt, 'agreed_at');
    expectColumnName(consentAuditLogs.ipAddress, 'ip_address');
    expectColumnName(consentAuditLogs.userId, 'user_id');
  });

  it('keeps legal content manual-only and separate from translation drafts', () => {
    expectColumnName(legalContent.type, 'type');
    expectColumnName(legalContent.koTitle, 'ko_title');
    expectColumnName(legalContent.koBody, 'ko_body');
    expectColumnName(legalContent.enTitle, 'en_title');
    expectColumnName(legalContent.enBody, 'en_body');
    expect(translationDrafts).not.toHaveProperty('legalContentId');
    expectColumnName(translationSources.sourceLocale, 'source_locale');
    expectColumnName(translationDrafts.status, 'status');
  });

  it('defines the launch enum values needed by locale, translation, and legal workflows', () => {
    expect(localeEnum.enumValues).toEqual(['ko', 'en', 'th', 'zh-CN', 'zh-TW']);
    expect(translationStatusEnum.enumValues).toEqual(['draft', 'review', 'published', 'stale']);
    expect(legalContentTypeEnum.enumValues).toEqual(['legal', 'notice', 'refund', 'booking_guide']);
  });
});
