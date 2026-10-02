import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import {
  ADMIN_SECURITY_MFA_DEFERRED_COPY,
  AdminSecuritySummary,
} from '../admin-security-summary';
import type { AdminSecurityStatusResponse } from '@/hooks/use-admin-security';

function status(
  overrides: Partial<AdminSecurityStatusResponse['ipAllowlist']> = {},
  currentRequest: Partial<AdminSecurityStatusResponse['currentRequest']> = {},
): AdminSecurityStatusResponse {
  return {
    mfa: { status: 'deferred_accepted_risk' },
    ipAllowlist: {
      mode: 'monitoring',
      activeRecords: 2,
      lastChangedAt: '2026-09-29T00:00:00.000Z',
      ...overrides,
    },
    lastAuditEventAt: null,
    currentRequest: {
      allowed: false,
      enforced: false,
      source: 'denied',
      maskedIpAddress: '100.64.0.0',
      matchedCidr: null,
      allowlistRecordId: null,
      reason: null,
      ...currentRequest,
    },
    deferredMfaCopy: 'server copy',
    requiredCapability: 'security.manage',
  };
}

describe('AdminSecuritySummary (audit #43)', () => {
  it('describes a monitoring-only allowlist without claiming it is enforced or that requests are denied', () => {
    render(<AdminSecuritySummary status={status()} isLoading={false} isError={false} />);

    expect(screen.getByText('확인만 · 차단 안 함')).toBeInTheDocument();
    expect(screen.queryByText('적용 중')).not.toBeInTheDocument();
    expect(screen.getByText(/관리자 요청을 접속 주소로 차단하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText('허용 목록 밖')).toBeInTheDocument();
    expect(screen.getByText('허용 목록에 없음')).toBeInTheDocument();
    expect(screen.queryByText('거부')).not.toBeInTheDocument();
    expect(screen.queryByText('접속 거부')).not.toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(ADMIN_SECURITY_MFA_DEFERRED_COPY).toContain('차단하지 않고 확인용으로만');
    expect(ADMIN_SECURITY_MFA_DEFERRED_COPY).not.toMatch(/허용된 접속 주소.*접근을 확인/);
  });

  it('keeps enforced labels for an enforcing API response', () => {
    render(
      <AdminSecuritySummary
        status={status({ mode: 'enforced' }, { enforced: true })}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByText('적용 중')).toBeInTheDocument();
    expect(screen.getByText('거부')).toBeInTheDocument();
    expect(screen.getByText('접속 거부')).toBeInTheDocument();
  });

  it('shows the non-production bypass as not evaluated', () => {
    render(
      <AdminSecuritySummary
        status={status(
          { mode: 'disabled', activeRecords: 0 },
          { allowed: true, source: 'non_production_bypass' },
        )}
        isLoading={false}
        isError={false}
      />,
    );

    expect(screen.getByText('미사용')).toBeInTheDocument();
    expect(screen.getByText('확인 안 함')).toBeInTheDocument();
    expect(screen.getByText('개발 환경 (확인 안 함)')).toBeInTheDocument();
  });
});
