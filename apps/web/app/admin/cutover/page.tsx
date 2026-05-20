'use client';

import { CutoverGateLedger } from '@/components/admin/cutover-gate-ledger';
import { useAdminCutoverGates } from '@/hooks/use-admin-cutover';

export default function AdminCutoverPage() {
  const cutover = useAdminCutoverGates();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-display font-semibold leading-[1.2] text-gray-900">
            컷오버 게이트
          </h1>
          <p className="mt-2 max-w-[760px] text-sm text-gray-600">
            Gate Ledger의 server-derived readiness를 기준으로 live ticketing no-go 사유, 승인 상태, evidence freshness, rollback/close trigger를 확인합니다.
          </p>
        </div>
      </div>

      <CutoverGateLedger
        summary={cutover.data}
        isLoading={cutover.isLoading}
        isError={cutover.isError}
        isRefreshing={cutover.isFetching && !cutover.isLoading}
        onRefresh={() => void cutover.refetch()}
      />
    </div>
  );
}
