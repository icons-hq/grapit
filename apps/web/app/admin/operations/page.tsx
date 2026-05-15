'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { OperationsInbox } from '@/components/admin/operations-inbox';
import {
  useAdminOperationsInbox,
  useAnswerOperation,
  useEscalateOperation,
  useReassignOperation,
  type OperationsInboxFilters,
} from '@/hooks/use-admin-operations';

export default function AdminOperationsPage() {
  const [filters, setFilters] = useState<OperationsInboxFilters>({});
  const inbox = useAdminOperationsInbox(filters);
  const answerOperation = useAnswerOperation();
  const escalateOperation = useEscalateOperation();
  const reassignOperation = useReassignOperation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">운영 인박스</h1>
        <p className="mt-2 text-sm text-gray-600">
          미답변 Q&A, CS, 환불 분쟁, 가입 실패와 SLA 상태를 하나의 큐에서 확인합니다.
        </p>
      </div>

      <OperationsInbox
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
            onSuccess: () => toast.success('운영 항목이 에스컬레이션되었습니다.'),
            onError: () => toast.error('에스컬레이션에 실패했습니다.'),
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
