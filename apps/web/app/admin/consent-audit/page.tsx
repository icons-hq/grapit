'use client';

import { useState } from 'react';
import {
  ConsentAuditTable,
  type ConsentAuditFilters,
  type ConsentAuditRow,
} from '@/components/admin/consent-audit-table';
import { useAdminConsentAudit } from '@/hooks/use-admin';

export default function AdminConsentAuditPage() {
  const [filters, setFilters] = useState<ConsentAuditFilters>({});
  const [selectedRow, setSelectedRow] = useState<ConsentAuditRow | null>(null);
  const { data, isLoading, isError } = useAdminConsentAudit(filters);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">동의 감사</h1>
        <p className="mt-1 text-sm text-gray-600">
          동의 항목, 버전, 언어, 사용자, 시각, IP 기준으로 masked 감사 증거를 조회합니다.
        </p>
      </div>

      <ConsentAuditTable
        auditRows={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onSearch={(nextFilters) => {
          setSelectedRow(null);
          setFilters(nextFilters);
        }}
        onRowOpen={setSelectedRow}
      />

      {selectedRow && (
        <section
          className="mt-4 rounded-lg bg-white p-4 text-sm shadow-sm"
          aria-label="동의 감사 상세"
        >
          <h2 className="text-base font-semibold text-gray-900">상세 증거</h2>
          <dl className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="font-semibold text-gray-600">항목</dt>
              <dd className="mt-1 text-gray-900">{selectedRow.itemKey}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-600">사용자</dt>
              <dd className="mt-1 text-gray-900">
                {selectedRow.maskedUser.email} / {selectedRow.maskedUser.phone}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-600">IP</dt>
              <dd className="mt-1 text-gray-900">{selectedRow.maskedIp}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-600">유입</dt>
              <dd className="mt-1 text-gray-900">{selectedRow.sourceFlow}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
