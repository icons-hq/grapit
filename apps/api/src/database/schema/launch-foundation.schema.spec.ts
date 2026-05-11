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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function expectColumnName(column: { name: string }, name: string) {
  expect(column.name).toBe(name);
}

function readMigrationFile(migrationDir: string, name: string) {
  return readFileSync(join(migrationDir, name), 'utf8');
}

describe('Phase 23 launch foundation schema contracts', () => {
  const migrationDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

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
    expectColumnName(consentAuditLogs.sourceFlow, 'source_flow');
  });

  it('seeds active launch consent items for every supported locale', () => {
    const source = readMigrationFile(
      migrationDir,
      '0011_seed_launch_consent_items.sql',
    );
    const keys = [
      'terms',
      'privacy',
      'pipa_required',
      'cross_border_transfer',
      'pdpa_notice',
      'pipl_notice',
      'marketing',
    ];
    const locales = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'];

    for (const locale of locales) {
      for (const key of keys) {
        expect(source).toContain(`('${key}', '2026-04-28', '${locale}'`);
      }
    }
    expect(source).toContain('ON CONFLICT ("key", "version", "locale")');
    expect(source).toContain('"is_active" = true');
  });

  it('relaxes launch consent items that are now handled as privacy notices', () => {
    const source = readMigrationFile(
      migrationDir,
      '0013_relax_launch_consent_requirements.sql',
    );

    for (const key of [
      'cross_border_transfer',
      'pdpa_notice',
      'pipl_notice',
    ]) {
      expect(source).toContain(`'${key}'`);
    }
    expect(source).toContain('"is_required" = false');
    expect(source).toContain('"is_active" = false');
  });

  it('keeps category collapse and consent seed migrations in a forward-only journal order', () => {
    const journal = JSON.parse(
      readMigrationFile(migrationDir, 'meta/_journal.json'),
    ) as {
      entries: Array<{ tag: string }>;
    };
    const tags = journal.entries.map((entry) => entry.tag);

    expect(tags).not.toContain('0009_seed_launch_consent_items');
    expect(tags).toContain('0009_two_event_categories');
    expect(tags).toContain('0010_collapse_legacy_genres');
    expect(tags).toContain('0011_seed_launch_consent_items');
    expect(tags).toContain('0013_relax_launch_consent_requirements');
    expect(tags.indexOf('0009_two_event_categories')).toBeLessThan(
      tags.indexOf('0010_collapse_legacy_genres'),
    );
    expect(tags.indexOf('0010_collapse_legacy_genres')).toBeLessThan(
      tags.indexOf('0011_seed_launch_consent_items'),
    );
    expect(tags.indexOf('0012_phase24_booking_core')).toBeLessThan(
      tags.indexOf('0013_relax_launch_consent_requirements'),
    );
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
