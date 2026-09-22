'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { OperationsInbox } from '@/components/admin/operations-inbox';
import { useAdminEventContext } from '@/components/admin/admin-event-context';
import {
  useAdminOperationsInbox,
  useAnswerOperation,
  useEscalateOperation,
  useReassignOperation,
  type OperationsInboxFilters,
} from '@/hooks/use-admin-operations';

export default function AdminOperationsPage() {
  const [filters, setFilters] = useState<OperationsInboxFilters>({});
  const context = useAdminEventContext();
  const inbox = useAdminOperationsInbox({ ...filters, performanceId: context?.performanceId || undefined, showtimeId: context?.showtimeId || undefined });
  const answerOperation = useAnswerOperation();
  const escalateOperation = useEscalateOperation();
  const reassignOperation = useReassignOperation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">고객 문의</h1>
        <p className="mt-2 text-sm text-gray-600">
          미답변 문의와 환불·가입 문제를 확인하고 답변합니다. 기한이 지난 문의부터 처리하세요.
          {context?.performanceId ? ' 현재 공연의 예매에 연결된 문의를 표시합니다. 공연 미지정 문의는 전체 공연에서 확인하세요.' : ''}
        </p>
      </div>

      <OperationsInbox
        key={`${context?.performanceId ?? ''}:${context?.showtimeId ?? ''}`}
        rows={inbox.data?.rows ?? []}
        isLoading={inbox.isLoading}
        isError={inbox.isError}
        filters={filters}
        onFilterChange={setFilters}
        onAnswer={(input) =>
          answerOperation.mutateAsync(input, {
            onSuccess: () => toast.success('운영 답변이 저장되었습니다.'),
            onError: () => toast.error('운영 답변 저장에 실패했습니다.'),
          })
        }
        onEscalate={(input) =>
          escalateOperation.mutateAsync(input, {
            onSuccess: () => toast.success('관리자에게 검토를 요청했습니다.'),
            onError: () => toast.error('관리자 검토 요청에 실패했습니다.'),
          })
        }
        onReassign={(input) =>
          reassignOperation.mutateAsync(input, {
            onSuccess: () => toast.success('담당자가 변경되었습니다.'),
            onError: () => toast.error('담당자 변경에 실패했습니다.'),
          })
        }
      />
    </div>
  );
}
