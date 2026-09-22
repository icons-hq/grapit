'use client';

import { useState } from 'react';
import { AdminAuditTable } from '@/components/admin/admin-audit-table';
import {
  ADMIN_AUDIT_REQUIRED_CAPABILITY,
  useAdminAudit,
  type AdminAuditFilters,
} from '@/hooks/use-admin-security';

export default function AdminAuditPage() {
  const [filters, setFilters] = useState<AdminAuditFilters>({ limit: 50 });
  const audit = useAdminAudit(filters);

  return (
    <div className="space-y-6" data-required-capability={ADMIN_AUDIT_REQUIRED_CAPABILITY}>
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">관리자 활동 기록</h1>
        <p className="mt-2 text-sm text-gray-600">
          누가 어떤 작업을 했는지 확인합니다. 변경 전후 내용은 개인정보를 가려 표시합니다.
        </p>
      </div>

      <AdminAuditTable
        rows={audit.data ?? []}
        filters={filters}
        isLoading={audit.isLoading}
        isError={audit.isError}
        onSearch={setFilters}
      />
    </div>
  );
}
