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
            판매 시작 점검
          </h1>
          <p className="mt-2 max-w-[760px] text-sm text-gray-600">
            판매 시작 전에 필요한 점검 결과와 승인 기록을 확인합니다. 미완료 항목을 해결한 뒤 판매를 시작하세요.
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
