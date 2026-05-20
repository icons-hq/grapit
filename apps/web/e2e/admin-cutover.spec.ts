import { expect, test } from '@playwright/test';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

const generatedAt = '2026-05-20T05:55:00.000Z';

const gateRows = [
  {
    gateId: 'M1_DIRECT_DEPLOY_WATCH',
    requirementIds: ['M1-01'],
    state: 'PASS',
    environment: 'production',
    evidenceRefs: ['evidence/26-07-direct-deploy-watch.json'],
    evidenceMissing: false,
    failureReason: null,
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring: null,
    rollbackOrCloseTrigger: 'Health 5xx or auth/session failure triggers rollback.',
    sourceDecisions: ['D-05', 'D-06', 'D-07'],
    redactionNotes: 'Revision identifiers are shortened.',
    blocking: false,
    blockingReason: null,
  },
  {
    gateId: 'TOSS_LIVE_KEY_SMOKE',
    requirementIds: ['PAY-01'],
    state: 'BLOCKED',
    environment: 'production',
    evidenceRefs: ['evidence/26-04-toss-hardening.json'],
    evidenceMissing: false,
    failureReason: 'Toss review is not complete; live-key smoke is blocked.',
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring: 'Keep BOOKING_ENABLED=false and monitor payment-safe paths only.',
    rollbackOrCloseTrigger: 'Do not enable live booking until live-key smoke is approved.',
    sourceDecisions: ['D-19', 'D-20', 'D-21', 'D-22'],
    redactionNotes: 'Only key prefix validation is linked.',
    blocking: true,
    blockingReason: 'Toss review is not complete; live-key smoke is blocked.',
  },
  {
    gateId: 'MFA_DEFERRED_ACCEPTED_RISK',
    requirementIds: ['OPS-01'],
    state: 'ACCEPTED_RISK',
    environment: 'production',
    evidenceRefs: ['25-HUMAN-UAT.md#mfa-deferred'],
    evidenceMissing: false,
    failureReason: 'MFA is deferred with owner approval.',
    approvalState: 'approved',
    approver: 'owner',
    approvalTimestamp: '2026-05-20T04:40:00.000Z',
    compensatingMonitoring: 'IP allowlist monitoring and audit log review.',
    rollbackOrCloseTrigger: 'Disable admin operations if suspicious admin access appears.',
    sourceDecisions: ['D-01', 'D-02', 'D-03'],
    redactionNotes: 'No IP address or raw audit payload is shown.',
    blocking: false,
    blockingReason: null,
  },
  {
    gateId: 'DB_HA_READ_REPLICA_CONFIG',
    requirementIds: ['DR-01', 'INFRA-01'],
    state: 'CONFIG_READY_NOT_DRILLED',
    environment: 'production',
    evidenceRefs: ['evidence/26-08-dr-infra.json'],
    evidenceMissing: false,
    failureReason: 'HA/read replica config evidence exists, but no live drill was run.',
    approvalState: 'requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring: 'Cloud SQL alerts and rollback runbook are prepared.',
    rollbackOrCloseTrigger: 'Close booking on DB failover uncertainty.',
    sourceDecisions: ['D-12'],
    redactionNotes: 'Project and instance identifiers are redacted.',
    blocking: true,
    blockingReason:
      'CONFIG_READY_NOT_DRILLED requires owner approval, monitoring, and rollback/close trigger.',
  },
] as const;

test.describe('Admin Cutover Gate Ledger E2E', () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminAuth(page);

    await page.route('**/api/v1/admin/operations/inbox**', async (route) => {
      await fulfillJson(route, {
        generatedAt,
        totals: { all: 0, escalated: 0, overdue: 0, dueSoon: 0 },
        rows: [],
      });
    });

    await page.route('**/api/v1/admin/cutover/gates', async (route) => {
      await fulfillJson(route, {
        generatedAt,
        ledgerGeneratedAt: generatedAt,
        source: {
          state: 'loaded',
          runtimeArtifactRequired: true,
          reason: null,
        },
        rows: gateRows,
        countsByState: {
          PASS: 1,
          FAIL: 0,
          ACCEPTED_RISK: 1,
          CONFIG_READY_NOT_DRILLED: 1,
          BLOCKED: 1,
        },
        missingEvidenceCount: 0,
        firstBlockingGate: gateRows[1],
        finalEnableAllowed: false,
        redactionNotes: [
          'Only Gate Ledger metadata and evidenceRefs are exposed by this API.',
          'No filesystem path, secret value, payment key, cookie, QR token, OTP, or PII is exposed.',
        ],
      });
    });
  });

  test('opens the cutover page from the sidebar and keeps non-PASS gates no-go', async ({
    page,
  }) => {
    await page.goto('/admin/operations');

    const cutoverLink = page.getByRole('link', { name: '컷오버 게이트' });
    await expect(cutoverLink).toHaveAttribute('href', '/admin/cutover');
    await cutoverLink.click();

    await expect(page).toHaveURL(/\/admin\/cutover$/);
    await expect(
      page.getByRole('heading', { name: '컷오버 게이트', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('아직 라이브 예매를 열 수 없습니다')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'TOSS_LIVE_KEY_SMOKE' }),
    ).toBeVisible();
    await expect(
      page
        .getByText('Toss review is not complete; live-key smoke is blocked.')
        .first(),
    ).toBeVisible();

    await expect(page.getByText('CONFIG_READY_NOT_DRILLED').first()).toBeVisible();
    await expect(
      page.getByText('설정 증거는 있지만 실제 drill PASS는 아닙니다'),
    ).toBeVisible();
    await expect(page.getByText('ACCEPTED_RISK').first()).toBeVisible();
    await expect(
      page.getByText(
        'PASS가 아닌 상태로 진행하려면 실패 게이트, 보완 모니터링, rollback trigger를 기록해야 합니다',
      ).first(),
    ).toBeVisible();

    const enableButton = page.getByRole('button', {
      name: 'BOOKING_ENABLED=true 활성화',
    });
    await expect(enableButton).toBeDisabled();
    await expect(
      page.getByText(
        'BOOKING_ENABLED=true는 TOSS_LIVE_KEY_SMOKE 때문에 비활성화되어 있습니다.',
      ),
    ).toBeVisible();
  });
});
