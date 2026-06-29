# Social Account Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link future social registrations to exactly one matching Buyer Account and repair existing duplicate Buyer Accounts through a protected, ledgered operator merge command.

**Architecture:** Keep runtime auth changes narrow inside `AuthService` and `UserRepository`. Put historical merge rules in a new `account-merge` module with pure policy helpers, a transaction-bound service, and a compiled CLI entrypoint. Store recovery evidence in database ledger tables plus a protected JSON report.

**Tech Stack:** NestJS 11, Drizzle ORM, PostgreSQL, Vitest, Zod shared contracts, Next.js admin UI contracts, pnpm.

---

## Source Documents

- `docs/superpowers/specs/2026-06-29-social-account-merge-design.md`
- `docs/adr/0008-use-ledgered-social-account-merge.md`
- `CONTEXT.md`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.service.spec.ts`
- `apps/api/src/modules/user/user.repository.ts`
- `apps/api/src/modules/user/user.service.ts`
- `apps/api/src/database/schema/users.ts`
- `apps/api/src/database/schema/social-accounts.ts`
- `apps/api/src/database/schema/reservations.ts`
- `packages/shared/src/types/user.types.ts`
- `packages/shared/src/schemas/admin-operations.schema.ts`
- `apps/web/components/admin/admin-user-management.tsx`

## File Structure

- Modify `packages/shared/src/types/user.types.ts`: add `merged` to `AccountStatus`.
- Modify `packages/shared/src/schemas/admin-operations.schema.ts`: add `merged` status and `merged` user stats count.
- Modify `packages/shared/src/schemas/admin-operations.schema.test.ts`: schema tests for merged account status.
- Modify `apps/api/src/database/schema/users.ts`: document accepted `account_status` values in code comments only if needed; column remains varchar.
- Create `apps/api/src/database/schema/account-merge.ts`: ledger tables and merge status enum.
- Modify `apps/api/src/database/schema/index.ts`: export merge ledger schema.
- Create `apps/api/src/database/migrations/0031_account_merge_ledger.sql`: add ledger tables, indexes, `user.merge` audit action.
- Create or modify a schema contract test under `apps/api/src/database/schema/account-merge.schema.spec.ts`.
- Modify `apps/api/src/modules/admin/admin-audit.service.ts`: add `user.merge`.
- Modify `apps/api/src/database/schema/admin-audit-logs.ts`: add `user.merge`.
- Modify `apps/api/src/modules/user/user.service.ts`: map `merged` to shared profile/admin output and reject profile mutation for inactive accounts.
- Modify `apps/api/src/modules/admin/admin-user.service.ts`: include merged stats and display status from DB.
- Modify `apps/web/components/admin/admin-user-management.tsx`: render merged status distinctly from active and withdrawn.
- Modify `apps/web/components/admin/__tests__/admin-user-management.test.tsx`: merged status UI test.
- Modify `apps/web/e2e/admin-users.spec.ts`: merged status fixture if admin user e2e status assertions need updating.
- Modify `apps/api/src/modules/user/user.repository.ts`: add active identity lookup by verified phone and birth date.
- Modify `apps/api/src/modules/auth/auth.service.ts`: link a new social provider to exactly one existing active identity match.
- Modify `apps/api/src/modules/auth/auth.service.spec.ts`: social linking tests.
- Create `apps/api/src/modules/account-merge/account-merge-policy.ts`: pure classification, target selection, masking, hash helpers.
- Create `apps/api/src/modules/account-merge/account-merge-policy.spec.ts`: dry-run classification tests.
- Create `apps/api/src/modules/account-merge/account-merge.service.ts`: DB-backed dry-run, apply, verify operations.
- Create `apps/api/src/modules/account-merge/account-merge.service.spec.ts`: transaction and row movement tests with Drizzle mocks.
- Create `apps/api/src/modules/account-merge/account-merge.module.ts`: CLI module registration.
- Create `apps/api/src/ops/account-merge.cli.ts`: compiled CLI entrypoint.
- Create `apps/api/src/ops/account-merge.cli.spec.ts`: argument validation and report path tests.
- Modify `apps/api/package.json`: add an `account-merge` script that runs the compiled CLI.
- Create `docs/runbooks/social-account-merge.md`: production dry-run/apply/verify runbook.
- Modify `apps/web/content/admin-patch-notes.ts`: add an operations note for ledgered account merge support.

## Current User Foreign Key Classification

Move to merge target:

- `reservations.user_id`
- `social_accounts.user_id`
- `terms_agreements.user_id`
- `consent_audit_logs.user_id`
- `support_threads.user_id`

Revoke or invalidate:

- `refresh_tokens.user_id`
- `email_verification_tokens.user_id`

Preserve as historical actor or operator context:

- `admin_audit_logs.actor_user_id`
- `booking_operation_audit_logs.operator_user_id`
- `seat_operation_history.actor_user_id`
- `ticket_scan_events.scanner_user_id`
- `ticket_benefit_configurations.created_by_user_id`
- `ticket_benefit_configurations.updated_by_user_id`
- `ticket_benefit_configuration_changes.actor_user_id`
- `ticket_benefit_runs.actor_user_id`
- `ticket_benefit_entitlements.redeemed_by_user_id`
- `ticket_benefit_redemption_records.scanner_user_id`
- `support_threads.assignee_user_id`
- `support_messages.author_user_id`
- `support_messages.reviewed_by_user_id`
- `support_faqs.created_by_user_id`
- `support_faqs.updated_by_user_id`
- `support_faqs.reviewed_by_user_id`
- `support_notices.created_by_user_id`
- `support_notices.updated_by_user_id`
- `support_notices.reviewed_by_user_id`
- `admin_access_allowlist.created_by_user_id`
- `performances.published_by_user_id`
- `legal_content.created_by`
- `translation_sources.created_by`
- `translation_drafts.reviewed_by`
- `users.withdrawn_by_user_id`

---

### Task 1: Account Status Contracts and Admin Display

**Files:**
- Modify: `packages/shared/src/types/user.types.ts`
- Modify: `packages/shared/src/schemas/admin-operations.schema.ts`
- Modify: `packages/shared/src/schemas/admin-operations.schema.test.ts`
- Modify: `apps/api/src/modules/user/user.service.ts`
- Modify: `apps/api/src/modules/admin/admin-user.service.ts`
- Modify: `apps/web/components/admin/admin-user-management.tsx`
- Modify: `apps/web/components/admin/__tests__/admin-user-management.test.tsx`
- Modify: `apps/web/e2e/admin-users.spec.ts` only if current fixtures assert the full status union

- [ ] **Step 1: Write failing shared status tests**

Add tests to `packages/shared/src/schemas/admin-operations.schema.test.ts`:

```ts
it('accepts merged account status in admin user rows and stats', () => {
  const row = adminUserListItemSchema.parse({
    id: 'user-merged-1',
    maskedEmail: 'm***@example.com',
    name: 'Merged User',
    maskedPhone: '+82******5678',
    role: 'user',
    country: 'KR',
    preferredLocale: 'ko',
    marketingConsent: false,
    adminCapabilityBundle: null,
    adminCapabilities: [],
    accountStatus: 'merged',
    withdrawnAt: null,
    withdrawalReason: 'merged into user-target-1',
    withdrawalSource: 'admin',
    verificationState: {
      email: true,
      phone: true,
      label: 'verified',
    },
    reservationSummary: {
      total: 0,
      statuses: {
        pendingPayment: 0,
        confirmed: 0,
        cancelled: 0,
        failed: 0,
      },
      lastReservationAt: null,
    },
    lastActivityAt: null,
    createdAt: '2026-06-29T00:00:00.000Z',
  });

  expect(row.accountStatus).toBe('merged');

  const stats = adminUserStatsResponseSchema.parse({
    total: 3,
    active: 1,
    withdrawn: 1,
    merged: 1,
    verification: {
      emailVerified: 1,
      phoneVerified: 1,
      fullyVerified: 1,
    },
    marketing: {
      consented: 0,
      notConsented: 3,
    },
    countries: [],
    locales: [],
    signupTrend: [],
    generatedAt: '2026-06-29T00:00:00.000Z',
  });

  expect(stats.merged).toBe(1);
});
```

- [ ] **Step 2: Run shared test to verify RED**

Run:

```bash
pnpm --filter @grabit/shared test -- admin-operations.schema.test.ts
```

Expected: FAIL because `merged` is not accepted in the schema or `AccountStatus`.

- [ ] **Step 3: Update shared types and schemas**

Change `packages/shared/src/types/user.types.ts`:

```ts
export type AccountStatus = 'active' | 'withdrawn' | 'merged';
```

Change `packages/shared/src/schemas/admin-operations.schema.ts`:

```ts
const accountStatusSchema = z.enum(['active', 'withdrawn', 'merged']);
```

Use `accountStatusSchema` for `adminUserListItemSchema.accountStatus`:

```ts
accountStatus: accountStatusSchema.default('active'),
```

Add `merged` to `adminUserStatsResponseSchema`:

```ts
merged: z.number().int().min(0),
```

- [ ] **Step 4: Update API user mapping**

In `apps/api/src/modules/user/user.service.ts`, replace binary account status mapping with:

```ts
function normalizeAccountStatus(
  status: string | null | undefined,
): UserProfile['accountStatus'] {
  if (status === 'withdrawn' || status === 'merged') return status;
  return 'active';
}
```

Use it in `mapToUserProfile()`:

```ts
accountStatus: normalizeAccountStatus(user.accountStatus),
```

In `updateProfile()`, block inactive accounts:

```ts
if (currentUser.accountStatus === 'withdrawn' || currentUser.accountStatus === 'merged') {
  throw new BadRequestException('비활성 계정은 프로필을 수정할 수 없습니다');
}
```

- [ ] **Step 5: Update admin user service stats and status mapping**

In `apps/api/src/modules/admin/admin-user.service.ts`, preserve `merged` in list/detail mappers:

```ts
function normalizeAdminAccountStatus(
  status: string | null | undefined,
): 'active' | 'withdrawn' | 'merged' {
  if (status === 'withdrawn' || status === 'merged') return status;
  return 'active';
}
```

Where stats currently count active and withdrawn, add:

```ts
merged: rows.filter((row) => row.accountStatus === 'merged').length,
```

Keep active count as only `accountStatus !== 'withdrawn' && accountStatus !== 'merged'`.

- [ ] **Step 6: Update admin UI labels**

In `apps/web/components/admin/admin-user-management.tsx`, replace binary labels with:

```ts
function accountStatusLabel(status: AdminUserDetail['accountStatus']) {
  if (status === 'withdrawn') return '탈퇴 처리';
  if (status === 'merged') return '병합됨';
  return '활성';
}

function accountStatusBadgeClass(status: AdminUserDetail['accountStatus']) {
  if (status === 'withdrawn') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (status === 'merged') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}
```

Use `accountStatusLabel(user.accountStatus)` everywhere the component currently checks `status === 'withdrawn' ? ... : ...`.

- [ ] **Step 7: Add web test for merged display**

In `apps/web/components/admin/__tests__/admin-user-management.test.tsx`, add:

```tsx
it('renders merged accounts as a distinct inactive state', async () => {
  const mergedUser = {
    ...listUser,
    id: 'user-merged-1',
    accountStatus: 'merged' as const,
    withdrawalReason: 'merged into user-target-1',
    withdrawalSource: 'admin' as const,
  };

  mockApiGet.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/users?')) {
      return Promise.resolve({
        items: [mergedUser],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    }
    if (path === '/api/v1/admin/users/stats') {
      return Promise.resolve({
        ...stats,
        total: 1,
        active: 0,
        withdrawn: 0,
        merged: 1,
      });
    }
    return defaultApiGet(path);
  });

  render(<AdminUserManagement />);

  expect(await screen.findByText('병합됨')).toBeInTheDocument();
});
```

- [ ] **Step 8: Run contract and UI tests**

Run:

```bash
pnpm --filter @grabit/shared test -- admin-operations.schema.test.ts
pnpm --filter @grabit/web test -- admin-user-management.test.tsx
pnpm --filter @grabit/api test -- user.service.spec.ts admin-user.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/types/user.types.ts packages/shared/src/schemas/admin-operations.schema.ts packages/shared/src/schemas/admin-operations.schema.test.ts apps/api/src/modules/user/user.service.ts apps/api/src/modules/admin/admin-user.service.ts apps/web/components/admin/admin-user-management.tsx apps/web/components/admin/__tests__/admin-user-management.test.tsx apps/web/e2e/admin-users.spec.ts
git commit -m "feat(auth): 병합 계정 상태를 추가"
```

---

### Task 2: Future Social Login Linking

**Files:**
- Modify: `apps/api/src/modules/user/user.repository.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing AuthService tests**

In `apps/api/src/modules/auth/auth.service.spec.ts`, add tests under `describe('completeSocialRegistration')`:

```ts
it('links a new social provider to exactly one active buyer identity match', async () => {
  const targetUser = {
    ...createMockUser(),
    id: randomUUID(),
    email: 'target@test.com',
    name: 'Existing Buyer',
    phone: '010-1234-5678',
    birthDate: '1995-05-15',
    isPhoneVerified: true,
    isEmailVerified: true,
    marketingConsent: false,
    accountStatus: 'active',
  };

  mockJwtService.verifyAsync.mockResolvedValue({
    provider: 'naver',
    providerId: 'naver-123',
    email: 'provider-email@test.com',
    name: 'Naver Buyer',
    purpose: 'social-registration',
  });
  mockUserRepo.findActiveByVerifiedIdentity.mockResolvedValue([targetUser]);

  const result = await authService.completeSocialRegistration(
    'valid-registration-token',
    {
      name: 'New Name Should Not Replace',
      gender: 'female',
      country: 'TH',
      birthDate: '1995-05-15',
      phone: '010-1234-5678',
      phoneVerificationToken: 'signed-social-phone-token',
      termsOfService: true,
      privacyPolicy: true,
      marketingConsent: true,
      consentItems: makeSocialConsentItems(),
    },
    { ipAddress: '203.0.113.44', userAgent: 'Vitest Link' },
  );

  expect(result).toMatchObject({
    accessToken: expect.any(String),
    refreshToken: expect.any(String),
    user: expect.objectContaining({
      id: targetUser.id,
      email: 'target@test.com',
      name: 'Existing Buyer',
      marketingConsent: true,
    }),
  });
  expect(mockUserRepo.create).not.toHaveBeenCalled();
  expect(mockDb.insert).toHaveBeenCalledWith(expect.objectContaining({
    _: expect.anything(),
  }));
  expect(mockConsentService.captureConsent).toHaveBeenCalledWith(
    targetUser.id,
    expect.objectContaining({ sourceFlow: 'social_completion' }),
    { ipAddress: '203.0.113.44', userAgent: 'Vitest Link' },
    expect.anything(),
  );
});

it('creates a new social user when multiple active buyer identity matches exist', async () => {
  mockJwtService.verifyAsync.mockResolvedValue({
    provider: 'google',
    providerId: 'google-456',
    email: 'google@test.com',
    name: 'Google Buyer',
    purpose: 'social-registration',
  });
  mockUserRepo.findActiveByVerifiedIdentity.mockResolvedValue([
    { ...createMockUser(), id: randomUUID(), isPhoneVerified: true, accountStatus: 'active' },
    { ...createMockUser(), id: randomUUID(), isPhoneVerified: true, accountStatus: 'active' },
  ]);
  mockUserRepo.findByEmail.mockResolvedValue(null);
  mockUserRepo.create.mockResolvedValue({
    ...createMockUser(),
    id: randomUUID(),
    email: 'google@test.com',
    passwordHash: null,
    isEmailVerified: true,
  });

  const result = await authService.completeSocialRegistration('valid-registration-token', {
    name: 'Google Buyer',
    gender: 'male',
    country: 'KR',
    birthDate: '1995-05-15',
    phone: '010-1234-5678',
    phoneVerificationToken: 'signed-social-phone-token',
    termsOfService: true,
    privacyPolicy: true,
    marketingConsent: false,
    consentItems: makeSocialConsentItems(),
  });

  expect(result).toMatchObject({ user: expect.objectContaining({ email: 'google@test.com' }) });
  expect(mockUserRepo.create).toHaveBeenCalled();
});

it('does not use provider email conflict to block a verified single-account match', async () => {
  const targetUser = {
    ...createMockUser(),
    id: randomUUID(),
    email: 'target@test.com',
    phone: '010-1234-5678',
    birthDate: '1995-05-15',
    isPhoneVerified: true,
    isEmailVerified: true,
    accountStatus: 'active',
  };

  mockJwtService.verifyAsync.mockResolvedValue({
    provider: 'kakao',
    providerId: 'kakao-789',
    email: 'email-owned-by-other@test.com',
    purpose: 'social-registration',
  });
  mockUserRepo.findActiveByVerifiedIdentity.mockResolvedValue([targetUser]);
  mockUserRepo.findByEmail.mockResolvedValue({ ...createMockUser(), email: 'email-owned-by-other@test.com' });

  await expect(authService.completeSocialRegistration('valid-registration-token', {
    name: 'Kakao Buyer',
    gender: 'male',
    country: 'KR',
    birthDate: '1995-05-15',
    phone: '010-1234-5678',
    phoneVerificationToken: 'signed-social-phone-token',
    termsOfService: true,
    privacyPolicy: true,
    marketingConsent: false,
    consentItems: makeSocialConsentItems(),
  })).resolves.toMatchObject({
    user: expect.objectContaining({ id: targetUser.id }),
  });
});
```

Extend the mock repo type in the test setup:

```ts
findActiveByVerifiedIdentity: ReturnType<typeof vi.fn>;
```

Initialize it:

```ts
findActiveByVerifiedIdentity: vi.fn().mockResolvedValue([]),
```

- [ ] **Step 2: Run AuthService test to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- auth.service.spec.ts
```

Expected: FAIL because `findActiveByVerifiedIdentity()` does not exist and `completeSocialRegistration()` still rejects provider email conflicts before identity linking.

- [ ] **Step 3: Add identity lookup to UserRepository**

In `apps/api/src/modules/user/user.repository.ts`, import `and`:

```ts
import { and, eq } from 'drizzle-orm';
```

Add:

```ts
async findActiveByVerifiedIdentity(
  phone: string,
  birthDate: string,
  db: Pick<DrizzleDB, 'select'> = this.db,
) {
  return db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.phone, phone),
        eq(schema.users.birthDate, birthDate),
        eq(schema.users.isPhoneVerified, true),
        eq(schema.users.accountStatus, 'active'),
      ),
    );
}
```

- [ ] **Step 4: Refactor AuthService inactive-account checks**

In `apps/api/src/modules/auth/auth.service.ts`, add:

```ts
function isInactiveAccountStatus(status: string | null | undefined): boolean {
  return status === 'withdrawn' || status === 'merged';
}
```

Replace checks like:

```ts
user.accountStatus === 'withdrawn'
```

with:

```ts
isInactiveAccountStatus(user.accountStatus)
```

Apply this to password login, refresh token user load, current-user email verification, and existing social login.

- [ ] **Step 5: Implement exact-match social linking**

In `completeSocialRegistration()`, after token/consent validation and before `findByEmail()`, add:

```ts
const identityMatches = await this.userRepository.findActiveByVerifiedIdentity(
  dto.phone,
  dto.birthDate,
);

if (identityMatches.length === 1) {
  const targetUser = identityMatches[0]!;

  const linkedUser = await this.db.transaction(async (tx) => {
    await tx.insert(schema.socialAccounts).values({
      userId: targetUser.id,
      provider: payload.provider,
      providerId: payload.providerId,
      providerEmail: payload.email,
    });

    await tx.insert(schema.termsAgreements).values({
      userId: targetUser.id,
      termsOfService: dto.termsOfService,
      privacyPolicy: dto.privacyPolicy,
      marketingConsent: dto.marketingConsent,
    });

    await this.consentService.captureConsent(
      targetUser.id,
      {
        birthDate: dto.birthDate,
        items: dto.consentItems,
        sourceFlow: 'social_completion',
      },
      requestMeta,
      tx,
    );

    const [updatedUser] = await tx
      .update(schema.users)
      .set({
        marketingConsent: dto.marketingConsent,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, targetUser.id))
      .returning();

    return updatedUser ?? targetUser;
  });

  const tokens = await this.generateTokenPair(
    linkedUser.id,
    linkedUser.email,
    linkedUser.role,
    normalizeAdminCapabilityBundle(linkedUser.adminCapabilityBundle),
    linkedUser.adminCapabilities,
  );

  return {
    ...tokens,
    user: this.mapToProfile({ ...linkedUser, isEmailVerified: true }),
  };
}
```

Keep the existing `findByEmail()` conflict path only for the create-new-user branch.

- [ ] **Step 6: Run AuthService tests**

Run:

```bash
pnpm --filter @grabit/api test -- auth.service.spec.ts
pnpm --filter @grabit/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/user/user.repository.ts apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.service.spec.ts
git commit -m "feat(auth): 소셜 로그인 계정 자동 연결을 추가"
```

---

### Task 3: Account Merge Ledger Schema

**Files:**
- Create: `apps/api/src/database/schema/account-merge.ts`
- Create: `apps/api/src/database/migrations/0031_account_merge_ledger.sql`
- Create: `apps/api/src/database/schema/account-merge.schema.spec.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Modify: `apps/api/src/database/schema/admin-audit-logs.ts`
- Modify: `apps/api/src/modules/admin/admin-audit.service.ts`

- [ ] **Step 1: Write failing schema contract test**

Create `apps/api/src/database/schema/account-merge.schema.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableColumns, getTableName } from 'drizzle-orm';
import {
  accountMergeBatches,
  accountMergeBatchStatusEnum,
  accountMergeRowChanges,
} from './account-merge';
import { adminAuditActionEnum } from './admin-audit-logs';

describe('account merge ledger schema', () => {
  const migration = readFileSync(
    resolve(__dirname, '../migrations/0031_account_merge_ledger.sql'),
    'utf8',
  );

  it('defines account merge ledger tables and status enum', () => {
    expect(getTableName(accountMergeBatches)).toBe('account_merge_batches');
    expect(getTableName(accountMergeRowChanges)).toBe('account_merge_row_changes');
    expect(accountMergeBatchStatusEnum.enumValues).toEqual([
      'dry_run',
      'applied',
      'verified',
      'failed',
      'rolled_back',
    ]);
  });

  it('defines recovery columns needed for row-level rollback evidence', () => {
    const batchColumns = getTableColumns(accountMergeBatches);
    expect(batchColumns.operatorUserId.name).toBe('operator_user_id');
    expect(batchColumns.backupReference.name).toBe('backup_reference');
    expect(batchColumns.dryRunHash.name).toBe('dry_run_hash');
    expect(batchColumns.allowlistHash.name).toBe('allowlist_hash');

    const rowColumns = getTableColumns(accountMergeRowChanges);
    expect(rowColumns.tableName.name).toBe('table_name');
    expect(rowColumns.rowId.name).toBe('row_id');
    expect(rowColumns.sourceUserId.name).toBe('source_user_id');
    expect(rowColumns.targetUserId.name).toBe('target_user_id');
    expect(rowColumns.beforeSnapshot.name).toBe('before_snapshot');
    expect(rowColumns.afterSnapshot.name).toBe('after_snapshot');
  });

  it('adds the user.merge audit action and ledger indexes', () => {
    expect(adminAuditActionEnum.enumValues).toContain('user.merge');
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'user.merge'");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS \"account_merge_batches\"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS \"account_merge_row_changes\"');
    expect(migration).toContain('idx_account_merge_row_changes_batch');
    expect(migration).toContain('idx_account_merge_row_changes_source_target');
  });
});
```

- [ ] **Step 2: Run schema test to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- account-merge.schema.spec.ts
```

Expected: FAIL because schema and migration do not exist.

- [ ] **Step 3: Add Drizzle ledger schema**

Create `apps/api/src/database/schema/account-merge.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const accountMergeBatchStatusEnum = pgEnum('account_merge_batch_status', [
  'dry_run',
  'applied',
  'verified',
  'failed',
  'rolled_back',
]);

export const accountMergeBatches = pgTable(
  'account_merge_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    status: accountMergeBatchStatusEnum('status').notNull(),
    operatorUserId: uuid('operator_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull(),
    backupReference: varchar('backup_reference', { length: 255 }).notNull(),
    dryRunHash: varchar('dry_run_hash', { length: 128 }).notNull(),
    allowlistHash: varchar('allowlist_hash', { length: 128 }),
    source: varchar('source', { length: 40 }).notNull().default('cli'),
    reportPath: text('report_path'),
    aggregateCounts: jsonb('aggregate_counts')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    verificationSummary: jsonb('verification_summary')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_account_merge_batches_status_created').on(table.status, table.createdAt),
    index('idx_account_merge_batches_operator').on(table.operatorUserId),
    index('idx_account_merge_batches_dry_run_hash').on(table.dryRunHash),
  ],
);

export const accountMergeRowChanges = pgTable(
  'account_merge_row_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => accountMergeBatches.id, { onDelete: 'cascade' }),
    mergeGroupKey: varchar('merge_group_key', { length: 255 }).notNull(),
    tableName: varchar('table_name', { length: 120 }).notNull(),
    rowId: varchar('row_id', { length: 160 }).notNull(),
    sourceUserId: uuid('source_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    beforeSnapshot: jsonb('before_snapshot')
      .$type<Record<string, unknown>>()
      .notNull(),
    afterSnapshot: jsonb('after_snapshot')
      .$type<Record<string, unknown>>()
      .notNull(),
    expectedRowCount: integer('expected_row_count').notNull().default(1),
    actualRowCount: integer('actual_row_count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_account_merge_row_changes_batch').on(table.batchId),
    index('idx_account_merge_row_changes_source_target').on(
      table.sourceUserId,
      table.targetUserId,
    ),
    index('idx_account_merge_row_changes_table_row').on(table.tableName, table.rowId),
  ],
);
```

- [ ] **Step 4: Export schema and add audit action**

Modify `apps/api/src/database/schema/index.ts`:

```ts
export {
  accountMergeBatches,
  accountMergeBatchStatusEnum,
  accountMergeRowChanges,
} from './account-merge.js';
```

Add `'user.merge'` to `adminAuditActionEnum` and `ADMIN_AUDIT_ACTIONS`.

- [ ] **Step 5: Add migration**

Create `apps/api/src/database/migrations/0031_account_merge_ledger.sql`:

```sql
DO $$ BEGIN
  CREATE TYPE "public"."account_merge_batch_status" AS ENUM (
    'dry_run',
    'applied',
    'verified',
    'failed',
    'rolled_back'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'user.merge';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_merge_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" "account_merge_batch_status" NOT NULL,
  "operator_user_id" uuid,
  "reason" text NOT NULL,
  "backup_reference" varchar(255) NOT NULL,
  "dry_run_hash" varchar(128) NOT NULL,
  "allowlist_hash" varchar(128),
  "source" varchar(40) DEFAULT 'cli' NOT NULL,
  "report_path" text,
  "aggregate_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "verification_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "applied_at" timestamp with time zone,
  "verified_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_merge_row_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "merge_group_key" varchar(255) NOT NULL,
  "table_name" varchar(120) NOT NULL,
  "row_id" varchar(160) NOT NULL,
  "source_user_id" uuid NOT NULL,
  "target_user_id" uuid NOT NULL,
  "before_snapshot" jsonb NOT NULL,
  "after_snapshot" jsonb NOT NULL,
  "expected_row_count" integer DEFAULT 1 NOT NULL,
  "actual_row_count" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_batches"
    ADD CONSTRAINT "account_merge_batches_operator_user_id_users_id_fk"
    FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_row_changes"
    ADD CONSTRAINT "account_merge_row_changes_batch_id_fk"
    FOREIGN KEY ("batch_id") REFERENCES "public"."account_merge_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_row_changes"
    ADD CONSTRAINT "account_merge_row_changes_source_user_id_users_id_fk"
    FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_row_changes"
    ADD CONSTRAINT "account_merge_row_changes_target_user_id_users_id_fk"
    FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_account_merge_batches_status_created"
  ON "account_merge_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_batches_operator"
  ON "account_merge_batches" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_batches_dry_run_hash"
  ON "account_merge_batches" USING btree ("dry_run_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_row_changes_batch"
  ON "account_merge_row_changes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_row_changes_source_target"
  ON "account_merge_row_changes" USING btree ("source_user_id","target_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_row_changes_table_row"
  ON "account_merge_row_changes" USING btree ("table_name","row_id");
```

- [ ] **Step 6: Run schema tests**

Run:

```bash
pnpm --filter @grabit/api test -- account-merge.schema.spec.ts admin-audit.service.spec.ts
pnpm --filter @grabit/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/database/schema/account-merge.ts apps/api/src/database/migrations/0031_account_merge_ledger.sql apps/api/src/database/schema/account-merge.schema.spec.ts apps/api/src/database/schema/index.ts apps/api/src/database/schema/admin-audit-logs.ts apps/api/src/modules/admin/admin-audit.service.ts
git commit -m "feat(account): 계정 병합 복구 원장을 추가"
```

---

### Task 4: Merge Policy Classification

**Files:**
- Create: `apps/api/src/modules/account-merge/account-merge-policy.ts`
- Create: `apps/api/src/modules/account-merge/account-merge-policy.spec.ts`

- [ ] **Step 1: Write failing policy tests**

Create `apps/api/src/modules/account-merge/account-merge-policy.spec.ts`:

```ts
import {
  buildMergeGroupKey,
  classifyDuplicateGroup,
  hashJson,
  maskMergeIdentity,
  normalizeMergeName,
  normalizeMergePhone,
} from './account-merge-policy';

const baseUser = {
  id: 'user-1',
  name: '홍 길동',
  phone: '+82 10-1234-5678',
  birthDate: '1995-05-15',
  isPhoneVerified: true,
  accountStatus: 'active',
};

describe('account merge policy', () => {
  it('normalizes identity evidence for historical duplicate grouping', () => {
    expect(normalizeMergePhone('+82 10-1234-5678')).toBe('821012345678');
    expect(normalizeMergeName(' 홍  길동 ')).toBe('홍길동');
    expect(buildMergeGroupKey(baseUser)).toBe('821012345678|1995-05-15|홍길동');
  });

  it('classifies one confirmed owner as an automatic safe merge group', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-1',
      users: [
        { ...baseUser, id: 'source-1' },
        { ...baseUser, id: 'target-1' },
      ],
      reservationCounts: {
        'source-1': { total: 0, confirmed: 0 },
        'target-1': { total: 2, confirmed: 1 },
      },
    });

    expect(result.kind).toBe('safe');
    expect(result.targetUserId).toBe('target-1');
    expect(result.sourceUserIds).toEqual(['source-1']);
  });

  it('requires manual review when multiple accounts own reservations', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-2',
      users: [
        { ...baseUser, id: 'user-a' },
        { ...baseUser, id: 'user-b' },
      ],
      reservationCounts: {
        'user-a': { total: 1, confirmed: 1 },
        'user-b': { total: 1, confirmed: 0 },
      },
    });

    expect(result.kind).toBe('manual_review');
    expect(result.reason).toBe('multiple_reservation_owners');
  });

  it('does not automatically merge groups without reservations', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-3',
      users: [
        { ...baseUser, id: 'user-a' },
        { ...baseUser, id: 'user-b' },
      ],
      reservationCounts: {
        'user-a': { total: 0, confirmed: 0 },
        'user-b': { total: 0, confirmed: 0 },
      },
    });

    expect(result.kind).toBe('manual_review');
    expect(result.reason).toBe('no_reservation_owner');
  });

  it('masks identity and hashes reports deterministically', () => {
    expect(maskMergeIdentity(baseUser)).toEqual({
      name: '홍*동',
      phone: '8210****5678',
      birthDate: '1995-**-**',
    });
    expect(hashJson({ b: 1, a: 2 })).toBe(hashJson({ a: 2, b: 1 }));
  });
});
```

- [ ] **Step 2: Run policy test to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- account-merge-policy.spec.ts
```

Expected: FAIL because policy module does not exist.

- [ ] **Step 3: Implement pure policy module**

Create `apps/api/src/modules/account-merge/account-merge-policy.ts`:

```ts
import { createHash } from 'node:crypto';

export interface MergeCandidateUser {
  id: string;
  name: string;
  phone: string;
  birthDate: string;
  isPhoneVerified: boolean;
  accountStatus: string;
}

export interface ReservationCounts {
  total: number;
  confirmed: number;
}

export interface DuplicateGroupInput {
  groupKey: string;
  users: MergeCandidateUser[];
  reservationCounts: Record<string, ReservationCounts>;
}

export type MergeClassification =
  | {
      kind: 'safe';
      groupKey: string;
      targetUserId: string;
      sourceUserIds: string[];
    }
  | {
      kind: 'manual_review';
      groupKey: string;
      reason:
        | 'identity_evidence_incomplete'
        | 'multiple_confirmed_owners'
        | 'multiple_reservation_owners'
        | 'no_reservation_owner';
      userIds: string[];
    };

export function normalizeMergePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeMergeName(name: string): string {
  return name.replace(/\s/g, '').trim().toLowerCase();
}

export function buildMergeGroupKey(user: Pick<MergeCandidateUser, 'phone' | 'birthDate' | 'name'>): string {
  return [
    normalizeMergePhone(user.phone),
    user.birthDate,
    normalizeMergeName(user.name),
  ].join('|');
}

export function classifyDuplicateGroup(input: DuplicateGroupInput): MergeClassification {
  const activeVerifiedUsers = input.users.filter(
    (user) => user.accountStatus === 'active' && user.isPhoneVerified,
  );
  if (activeVerifiedUsers.length !== input.users.length) {
    return {
      kind: 'manual_review',
      groupKey: input.groupKey,
      reason: 'identity_evidence_incomplete',
      userIds: input.users.map((user) => user.id).sort(),
    };
  }

  const confirmedOwners = activeVerifiedUsers.filter(
    (user) => (input.reservationCounts[user.id]?.confirmed ?? 0) > 0,
  );
  if (confirmedOwners.length > 1) {
    return {
      kind: 'manual_review',
      groupKey: input.groupKey,
      reason: 'multiple_confirmed_owners',
      userIds: activeVerifiedUsers.map((user) => user.id).sort(),
    };
  }
  if (confirmedOwners.length === 1) {
    return buildSafeResult(input.groupKey, activeVerifiedUsers, confirmedOwners[0]!.id);
  }

  const reservationOwners = activeVerifiedUsers.filter(
    (user) => (input.reservationCounts[user.id]?.total ?? 0) > 0,
  );
  if (reservationOwners.length > 1) {
    return {
      kind: 'manual_review',
      groupKey: input.groupKey,
      reason: 'multiple_reservation_owners',
      userIds: activeVerifiedUsers.map((user) => user.id).sort(),
    };
  }
  if (reservationOwners.length === 1) {
    return buildSafeResult(input.groupKey, activeVerifiedUsers, reservationOwners[0]!.id);
  }

  return {
    kind: 'manual_review',
    groupKey: input.groupKey,
    reason: 'no_reservation_owner',
    userIds: activeVerifiedUsers.map((user) => user.id).sort(),
  };
}

function buildSafeResult(
  groupKey: string,
  users: MergeCandidateUser[],
  targetUserId: string,
): Extract<MergeClassification, { kind: 'safe' }> {
  return {
    kind: 'safe',
    groupKey,
    targetUserId,
    sourceUserIds: users
      .map((user) => user.id)
      .filter((userId) => userId !== targetUserId)
      .sort(),
  };
}

export function maskMergeIdentity(user: Pick<MergeCandidateUser, 'name' | 'phone' | 'birthDate'>) {
  const phoneDigits = normalizeMergePhone(user.phone);
  return {
    name: maskName(user.name),
    phone: `${phoneDigits.slice(0, 4)}****${phoneDigits.slice(-4)}`,
    birthDate: `${user.birthDate.slice(0, 4)}-**-**`,
  };
}

function maskName(name: string): string {
  const compact = name.replace(/\s/g, '');
  if (compact.length <= 1) return compact;
  if (compact.length === 2) return `${compact[0]}*`;
  return `${compact[0]}*${compact[compact.length - 1]}`;
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Run policy test**

Run:

```bash
pnpm --filter @grabit/api test -- account-merge-policy.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/account-merge/account-merge-policy.ts apps/api/src/modules/account-merge/account-merge-policy.spec.ts
git commit -m "feat(account): 계정 병합 분류 규칙을 추가"
```

---

### Task 5: Account Merge Service Apply and Verify

**Files:**
- Create: `apps/api/src/modules/account-merge/account-merge.service.ts`
- Create: `apps/api/src/modules/account-merge/account-merge.service.spec.ts`
- Create: `apps/api/src/modules/account-merge/account-merge.module.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/api/src/modules/account-merge/account-merge.service.spec.ts` with these test names:

```ts
describe('AccountMergeService', () => {
  it('dry-run classifies safe groups and manual review groups from duplicate identities', async () => {});
  it('applies a safe merge by moving buyer-owned rows and revoking source sessions', async () => {});
  it('applies a manual allowlist merge when target and sources are explicit', async () => {});
  it('marks source accounts as merged and writes row-level recovery records', async () => {});
  it('rolls back when an update row count differs from the expected row count', async () => {});
  it('verifies target visibility and source cleanup after a batch', async () => {});
});
```

Use a Drizzle mock whose `transaction` captures thrown errors:

```ts
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(async (callback: (tx: typeof mockDb) => Promise<unknown>) =>
    callback(mockDb),
  ),
};
```

For the apply test, assert the service updates these tables:

```ts
expect(updatedTables).toEqual([
  'reservations',
  'social_accounts',
  'terms_agreements',
  'consent_audit_logs',
  'support_threads',
  'refresh_tokens',
  'email_verification_tokens',
  'users',
]);
```

- [ ] **Step 2: Run service test to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- account-merge.service.spec.ts
```

Expected: FAIL because service and module do not exist.

- [ ] **Step 3: Implement service interfaces**

Create `apps/api/src/modules/account-merge/account-merge.service.ts` with exported interfaces:

```ts
export interface ManualMergeAllowlistEntry {
  groupKey: string;
  targetUserId: string;
  sourceUserIds: string[];
  reason: string;
}

export interface AccountMergeDryRunOptions {
  includeManualAllowlist?: ManualMergeAllowlistEntry[];
}

export interface AccountMergeApplyOptions {
  operatorUserId: string | null;
  reason: string;
  backupReference: string;
  reportPath: string;
  dryRunHash: string;
  allowlistHash: string | null;
  manualAllowlist: ManualMergeAllowlistEntry[];
}

export interface AccountMergeVerifyResult {
  batchId: string;
  sourceUsersWithoutReservations: string[];
  sourceUsersWithoutSocialLinks: string[];
  sourceUsersWithActiveRefreshTokens: string[];
  targetUsersWithReservations: string[];
}
```

- [ ] **Step 4: Implement dry-run query and classification**

Inside `AccountMergeService`, add:

```ts
async dryRun(options: AccountMergeDryRunOptions = {}) {
  const candidates = await this.loadDuplicateIdentityCandidates();
  const groups = candidates.map((group) =>
    classifyDuplicateGroup({
      groupKey: group.groupKey,
      users: group.users,
      reservationCounts: group.reservationCounts,
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    safeGroups: groups.filter((group) => group.kind === 'safe'),
    manualReviewGroups: groups.filter((group) => group.kind === 'manual_review'),
    manualAllowlist: options.includeManualAllowlist ?? [],
  };
}
```

Implement `loadDuplicateIdentityCandidates()` with SQL grouping:

```ts
const rows = await this.db.execute(sql`
  with identity_users as (
    select
      id,
      name,
      phone,
      birth_date,
      is_phone_verified,
      account_status,
      regexp_replace(phone, '[^0-9]', '', 'g') as phone_digits,
      lower(regexp_replace(name, '\\s+', '', 'g')) as normalized_name
    from users
    where account_status = 'active'
      and is_phone_verified = true
  ),
  duplicate_keys as (
    select phone_digits, birth_date, normalized_name, count(*) as user_count
    from identity_users
    group by phone_digits, birth_date, normalized_name
    having count(*) > 1
  )
  select
    iu.id,
    iu.name,
    iu.phone,
    iu.birth_date,
    iu.is_phone_verified,
    iu.account_status,
    iu.phone_digits,
    iu.normalized_name,
    coalesce(count(r.id), 0)::int as reservation_count,
    coalesce(count(r.id) filter (where r.status = 'CONFIRMED'), 0)::int as confirmed_count
  from identity_users iu
  join duplicate_keys dk
    on dk.phone_digits = iu.phone_digits
   and dk.birth_date = iu.birth_date
   and dk.normalized_name = iu.normalized_name
  left join reservations r on r.user_id = iu.id
  group by
    iu.id,
    iu.name,
    iu.phone,
    iu.birth_date,
    iu.is_phone_verified,
    iu.account_status,
    iu.phone_digits,
    iu.normalized_name
`);
```

Convert rows into `DuplicateGroupInput[]` by group key.

- [ ] **Step 5: Implement transaction apply**

Implement `apply()` as:

```ts
async apply(options: AccountMergeApplyOptions) {
  const dryRun = await this.dryRun({ includeManualAllowlist: options.manualAllowlist });
  const applyGroups = [
    ...dryRun.safeGroups,
    ...options.manualAllowlist.map((entry) => ({
      kind: 'safe' as const,
      groupKey: entry.groupKey,
      targetUserId: entry.targetUserId,
      sourceUserIds: [...entry.sourceUserIds].sort(),
    })),
  ];

  return this.db.transaction(async (tx) => {
    const [batch] = await tx.insert(accountMergeBatches).values({
      status: 'applied',
      operatorUserId: options.operatorUserId,
      reason: options.reason,
      backupReference: options.backupReference,
      dryRunHash: options.dryRunHash,
      allowlistHash: options.allowlistHash,
      reportPath: options.reportPath,
      aggregateCounts: {
        safeGroups: dryRun.safeGroups.length,
        manualReviewGroups: dryRun.manualReviewGroups.length,
        appliedGroups: applyGroups.length,
      },
      appliedAt: new Date(),
    }).returning();

    for (const group of applyGroups) {
      await this.applyGroup(tx, batch!.id, group);
    }

    return {
      batchId: batch!.id,
      appliedGroups: applyGroups.length,
    };
  });
}
```

`applyGroup()` must:

1. Load before snapshots for each source from moved/revoked tables.
2. Update `reservations`, `social_accounts`, `terms_agreements`, `consent_audit_logs`, and `support_threads` from source to target.
3. Revoke unrevoked `refresh_tokens` for sources.
4. Mark source `email_verification_tokens` as consumed when `consumed_at is null`.
5. Update source `users` with `account_status='merged'`, `marketing_consent=false`, `updated_at=now()`, `withdrawal_reason='merged into <targetUserId>'`, `withdrawal_source='admin'`, `withdrawn_by_user_id=<operatorUserId when present>`.
6. Insert one `account_merge_row_changes` row for each changed row.
7. Throw `new Error('ACCOUNT_MERGE_ROW_COUNT_MISMATCH:<tableName>')` when expected and actual update counts differ.

- [ ] **Step 6: Implement verify**

Add:

```ts
async verify(batchId: string): Promise<AccountMergeVerifyResult> {
  const changes = await this.loadBatchChanges(batchId);
  const sourceUserIds = [...new Set(changes.map((change) => change.sourceUserId))];
  const targetUserIds = [...new Set(changes.map((change) => change.targetUserId))];

  return {
    batchId,
    sourceUsersWithoutReservations: await this.filterUsersWithoutRows(reservations, sourceUserIds),
    sourceUsersWithoutSocialLinks: await this.filterUsersWithoutRows(socialAccounts, sourceUserIds),
    sourceUsersWithActiveRefreshTokens: await this.findUsersWithActiveRefreshTokens(sourceUserIds),
    targetUsersWithReservations: await this.filterUsersWithRows(reservations, targetUserIds),
  };
}
```

The success condition for CLI verify is:

```ts
sourceUsersWithoutReservations.length === sourceUserIds.length
sourceUsersWithoutSocialLinks.length === sourceUserIds.length
sourceUsersWithActiveRefreshTokens.length === 0
targetUsersWithReservations.length === targetUserIds.length
```

- [ ] **Step 7: Register module**

Create `apps/api/src/modules/account-merge/account-merge.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from '../../database/drizzle.module.js';
import { AccountMergeService } from './account-merge.service.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }), DrizzleModule],
  providers: [AccountMergeService],
  exports: [AccountMergeService],
})
export class AccountMergeModule {}
```

- [ ] **Step 8: Run service tests**

Run:

```bash
pnpm --filter @grabit/api test -- account-merge.service.spec.ts
pnpm --filter @grabit/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/account-merge/account-merge.service.ts apps/api/src/modules/account-merge/account-merge.service.spec.ts apps/api/src/modules/account-merge/account-merge.module.ts
git commit -m "feat(account): 계정 병합 적용 서비스를 추가"
```

---

### Task 6: Protected Operator CLI and JSON Report

**Files:**
- Create: `apps/api/src/ops/account-merge.cli.ts`
- Create: `apps/api/src/ops/account-merge.cli.spec.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write failing CLI tests**

Create `apps/api/src/ops/account-merge.cli.spec.ts`:

```ts
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseAccountMergeArgs,
  requireApplySafetyInputs,
  writeProtectedReport,
} from './account-merge.cli';

describe('account merge CLI helpers', () => {
  it('parses dry-run mode with report path', () => {
    expect(parseAccountMergeArgs([
      'dry-run',
      '--report',
      '/tmp/account-merge-report.json',
    ])).toEqual({
      mode: 'dry-run',
      reportPath: '/tmp/account-merge-report.json',
      allowlistPath: null,
      backupReference: null,
      batchId: null,
      operatorUserId: null,
      reason: null,
    });
  });

  it('requires backup reference, operator, reason, report, and allowlist for apply', () => {
    expect(() => requireApplySafetyInputs({
      mode: 'apply',
      reportPath: '/tmp/report.json',
      allowlistPath: null,
      backupReference: 'cloudsql-backup-20260629',
      batchId: null,
      operatorUserId: 'operator-1',
      reason: 'merge approved groups',
    })).toThrow('ACCOUNT_MERGE_ALLOWLIST_REQUIRED');
  });

  it('writes protected reports with user-only permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'account-merge-'));
    const reportPath = join(dir, 'report.json');
    writeProtectedReport(reportPath, { ok: true });

    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ ok: true });
    expect((statSync(reportPath).mode & 0o777).toString(8)).toBe('600');
  });
});
```

- [ ] **Step 2: Run CLI test to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- account-merge.cli.spec.ts
```

Expected: FAIL because CLI module does not exist.

- [ ] **Step 3: Implement CLI helpers and entrypoint**

Create `apps/api/src/ops/account-merge.cli.ts`:

```ts
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AccountMergeModule } from '../modules/account-merge/account-merge.module.js';
import { AccountMergeService } from '../modules/account-merge/account-merge.service.js';
import { hashJson } from '../modules/account-merge/account-merge-policy.js';

export type AccountMergeCliMode = 'dry-run' | 'apply' | 'verify';

export interface AccountMergeCliArgs {
  mode: AccountMergeCliMode;
  reportPath: string | null;
  allowlistPath: string | null;
  backupReference: string | null;
  batchId: string | null;
  dryRunHash: string | null;
  operatorUserId: string | null;
  reason: string | null;
}

export function parseAccountMergeArgs(argv: string[]): AccountMergeCliArgs {
  const [modeValue, ...rest] = argv;
  if (modeValue !== 'dry-run' && modeValue !== 'apply' && modeValue !== 'verify') {
    throw new Error('ACCOUNT_MERGE_MODE_REQUIRED');
  }

  const args: AccountMergeCliArgs = {
    mode: modeValue,
    reportPath: null,
    allowlistPath: null,
    backupReference: null,
    batchId: null,
    dryRunHash: null,
    operatorUserId: null,
    reason: null,
  };

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key || !value) throw new Error('ACCOUNT_MERGE_INVALID_ARGUMENTS');
    if (key === '--report') args.reportPath = value;
    else if (key === '--allowlist') args.allowlistPath = value;
    else if (key === '--backup-reference') args.backupReference = value;
    else if (key === '--batch-id') args.batchId = value;
    else if (key === '--dry-run-hash') args.dryRunHash = value;
    else if (key === '--operator-user-id') args.operatorUserId = value;
    else if (key === '--reason') args.reason = value;
    else throw new Error(`ACCOUNT_MERGE_UNKNOWN_ARGUMENT:${key}`);
  }

  return args;
}

export function requireApplySafetyInputs(args: AccountMergeCliArgs): void {
  if (args.mode !== 'apply') return;
  if (!args.reportPath) throw new Error('ACCOUNT_MERGE_REPORT_REQUIRED');
  if (!args.allowlistPath) throw new Error('ACCOUNT_MERGE_ALLOWLIST_REQUIRED');
  if (!args.backupReference) throw new Error('ACCOUNT_MERGE_BACKUP_REFERENCE_REQUIRED');
  if (!args.dryRunHash) throw new Error('ACCOUNT_MERGE_DRY_RUN_HASH_REQUIRED');
  if (!args.operatorUserId) throw new Error('ACCOUNT_MERGE_OPERATOR_REQUIRED');
  if (!args.reason || args.reason.trim().length < 10) {
    throw new Error('ACCOUNT_MERGE_REASON_REQUIRED');
  }
}

export function writeProtectedReport(path: string, payload: unknown): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

async function main() {
  const args = parseAccountMergeArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AccountMergeModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const service = app.get(AccountMergeService);

    if (args.mode === 'dry-run') {
      if (!args.reportPath) throw new Error('ACCOUNT_MERGE_REPORT_REQUIRED');
      const dryRun = await service.dryRun();
      writeProtectedReport(args.reportPath, dryRun);
      console.log(JSON.stringify({
        mode: 'dry-run',
        reportPath: args.reportPath,
        dryRunHash: hashJson(dryRun),
      }));
      return;
    }

    if (args.mode === 'apply') {
      requireApplySafetyInputs(args);
      const allowlist = JSON.parse(readFileSync(args.allowlistPath!, 'utf8'));
      const dryRun = await service.dryRun({ includeManualAllowlist: allowlist });
      if (args.dryRunHash !== hashJson(dryRun)) {
        throw new Error('ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH');
      }
      const result = await service.apply({
        operatorUserId: args.operatorUserId,
        reason: args.reason!,
        backupReference: args.backupReference!,
        reportPath: args.reportPath!,
        dryRunHash: args.dryRunHash,
        allowlistHash: hashJson(allowlist),
        manualAllowlist: allowlist,
      });
      writeProtectedReport(args.reportPath!, { dryRun, result });
      console.log(JSON.stringify({ mode: 'apply', ...result }));
      return;
    }

    if (!args.batchId) throw new Error('ACCOUNT_MERGE_BATCH_ID_REQUIRED');
    const verification = await service.verify(args.batchId);
    if (args.reportPath) {
      writeProtectedReport(args.reportPath, verification);
    }
    console.log(JSON.stringify({ mode: 'verify', verification }));
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('account-merge.cli.js')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Add package script**

Modify `apps/api/package.json`:

```json
"account-merge": "node dist/ops/account-merge.cli.js"
```

Operator usage after build:

```bash
corepack pnpm@10.28.1 --filter @grabit/api build
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- dry-run --report /secure/account-merge-dry-run.json
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- apply --report /secure/account-merge-apply.json --allowlist /secure/account-merge-allowlist.json --backup-reference cloudsql-backup-20260629 --operator-user-id <operator-user-id> --reason "approved duplicate buyer account merge" --dry-run-hash <reviewed-dry-run-hash>
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- verify --batch-id <batch-id> --report /secure/account-merge-verify.json
```

- [ ] **Step 5: Run CLI tests**

Run:

```bash
corepack pnpm@10.28.1 --filter @grabit/api test -- account-merge.cli.spec.ts
corepack pnpm@10.28.1 --filter @grabit/api build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ops/account-merge.cli.ts apps/api/src/ops/account-merge.cli.spec.ts apps/api/package.json
git commit -m "feat(account): 보호된 계정 병합 명령을 추가"
```

---

### Task 7: Runbook, Patch Note, and Final Verification

**Files:**
- Create: `docs/runbooks/social-account-merge.md`
- Modify: `apps/web/content/admin-patch-notes.ts`
- Modify: `docs/superpowers/plans/2026-06-29-social-account-merge.md`

- [ ] **Step 1: Write runbook**

Create `docs/runbooks/social-account-merge.md`:

```md
# Social Account Merge Runbook

## Purpose

Use this runbook to dry-run, apply, and verify duplicate Buyer Account merges after the social account merge code is deployed.

## Safety Requirements

- Confirm the target environment before every command.
- Confirm a current Cloud SQL backup or snapshot reference.
- Keep generated JSON reports in a protected operator location.
- Do not paste raw report contents into chat, GitHub comments, public logs, or customer-facing surfaces.
- Apply mode is limited to Safe Merge Groups plus Manual Merge Allowlist entries.
- Apply mode requires the reviewed `dryRunHash` from the immediately preceding dry-run.

## Dry Run

```bash
corepack pnpm@10.28.1 --filter @grabit/api build
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- dry-run --report /secure/account-merge-dry-run.json
```

Record the printed `dryRunHash`. Do not continue to apply if the dry-run report was not reviewed.

## Manual Allowlist

Create a JSON array:

```json
[
  {
    "groupKey": "821012345678|1995-05-15|hong",
    "targetUserId": "00000000-0000-4000-8000-000000000001",
    "sourceUserIds": ["00000000-0000-4000-8000-000000000002"],
    "reason": "operator verified both reservation owners belong to the same buyer"
  }
]
```

Use an empty array when no manual groups are approved:

```json
[]
```

## Apply

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- apply \
  --report /secure/account-merge-apply.json \
  --allowlist /secure/account-merge-allowlist.json \
  --backup-reference cloudsql-backup-20260629 \
  --operator-user-id 00000000-0000-4000-8000-000000000099 \
  --reason "approved duplicate buyer account merge after dry-run review" \
  --dry-run-hash <reviewed-dry-run-hash>
```

If the current database state no longer matches the reviewed dry-run hash, apply fails. Run a new dry-run and review again before retrying.

## Verify

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- verify \
  --batch-id 00000000-0000-4000-8000-000000000123 \
  --report /secure/account-merge-verify.json
```

## Success Criteria

- Source accounts own no reservations.
- Source accounts own no social login links.
- Source accounts have no active refresh tokens.
- Target accounts own the moved reservations.
- Kakao, Naver, Google, or other moved provider links resolve to the target account.
- Source accounts are marked `merged`, not `withdrawn` and not deleted.
- DB ledger contains the batch and row changes.
- Protected JSON reports are preserved in the operator evidence location.
```

- [ ] **Step 2: Add admin patch note entry**

Add a new note at the top of `apps/web/content/admin-patch-notes.ts` with `prNumber: 0` until PR creation:

```ts
{
  id: 'pr-000-ledgered-social-account-merge',
  prNumber: 0,
  title: '소셜 계정 병합 운영 도구 추가',
  summary:
    '휴대폰 인증과 생년월일이 일치하는 소셜 로그인은 기존 계정에 연결하고, 기존 중복 계정은 복구 원장과 보호된 리포트를 남기며 병합할 수 있도록 운영 명령을 추가했습니다.',
  highlights: [
    '새 소셜 로그인은 정확히 하나의 활성 계정과 일치할 때 기존 계정에 연결',
    'safe group 자동 병합과 수동 allowlist 병합을 분리',
    'source 계정은 merged 상태로 보존하고 refresh token은 폐기',
    '병합 batch와 row 변경 내역을 DB ledger와 protected JSON report에 기록',
  ],
  category: 'ops',
  date: '2026-06-29',
  githubUrl: 'https://github.com/sangwopark19/grapit/pull/0',
  evidence: [
    'Shared admin schema Vitest',
    'API auth/account-merge Vitest',
    'API schema contract Vitest',
    'API build/typecheck',
    'Web admin user management Vitest',
    'git diff --check',
  ],
}
```

After PR creation, update `prNumber` and `githubUrl` to the real PR number and URL.

- [ ] **Step 3: Run targeted validation**

Run:

```bash
corepack pnpm@10.28.1 --filter @grabit/shared test -- admin-operations.schema.test.ts
corepack pnpm@10.28.1 --filter @grabit/api test -- auth.service.spec.ts account-merge.schema.spec.ts account-merge-policy.spec.ts account-merge.service.spec.ts account-merge.cli.spec.ts admin-audit.service.spec.ts user.service.spec.ts admin-user.service.spec.ts
corepack pnpm@10.28.1 --filter @grabit/web test -- admin-user-management.test.tsx
corepack pnpm@10.28.1 --filter @grabit/api typecheck
corepack pnpm@10.28.1 --filter @grabit/shared typecheck
corepack pnpm@10.28.1 --filter @grabit/web typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Run broad validation if targeted validation passes**

Run:

```bash
corepack pnpm@10.28.1 lint
corepack pnpm@10.28.1 typecheck
corepack pnpm@10.28.1 test
corepack pnpm@10.28.1 build
```

Expected: PASS, or documented unrelated existing failure with command output and affected package.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/social-account-merge.md apps/web/content/admin-patch-notes.ts docs/superpowers/plans/2026-06-29-social-account-merge.md
git commit -m "docs(account): 계정 병합 운영 절차를 문서화"
```

---

## Execution Notes

- Create or switch to an implementation branch before applying this plan if the current branch is still the design branch.
- Do not run production `apply` until code is deployed, production dry-run has been reviewed, and a backup reference is confirmed.
- Do not print raw JSON report contents in chat or GitHub comments.
- If a row count mismatch happens in `apply`, treat it as a failed safety assertion and do not retry without a fresh dry-run.

## Self-Review

- Spec coverage: future social linking, historical safe merge, manual allowlist, `merged` source state, recovery ledger, protected report, and production verification are all covered by Tasks 1-7.
- Placeholder scan: this plan contains concrete file paths, commands, test names, and code snippets for each implementation task.
- Type consistency: account status uses `active | withdrawn | merged`; merge classification uses `safe | manual_review`; batch status uses `dry_run | applied | verified | failed | rolled_back`.
