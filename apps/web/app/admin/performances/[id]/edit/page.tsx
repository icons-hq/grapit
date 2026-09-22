'use client';

import { use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { performancePreparationStepSchema } from '@grabit/shared';
import { usePerformanceDraft } from '@/hooks/use-performance-preparation';
import { useAdminPerformanceDetail } from '@/hooks/use-admin';
import { PerformanceForm } from '@/components/admin/performance-form';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminPerformanceEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const search = useSearchParams();
  const draftId = search.get('draftId') ?? '';
  const draft = usePerformanceDraft(draftId);
  const initialStep = performancePreparationStepSchema.safeParse(search.get('step'));
  const { data, isLoading, isError } = useAdminPerformanceDetail(id);

  if (isLoading || (draftId && draft.isPending)) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (draftId && (draft.isError || !draft.data || draft.data.performanceId !== id)) {
    return <p role="alert">이 공연의 초안을 불러오지 못했습니다. <Link className="underline" href={`/admin/performances/${id}`}>준비 화면으로 돌아가기</Link></p>;
  }
  if (draft.data?.appliedAt) return <p>이미 반영된 초안입니다. <Link className="underline" href={`/admin/performances/${id}`}>공연 준비 화면 열기</Link></p>;

  if (isError || !data) {
    return (
      <div className="py-12 text-center text-gray-500">
        <p>데이터를 불러오지 못했습니다. 새로고침하거나 잠시 후 다시 시도해주세요.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          새로고침
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-display font-semibold leading-[1.2]">
        공연 수정
      </h1>
      <PerformanceForm key={draftId || id} mode="edit" initialData={data} performanceId={id} initialDraft={draft.data}
        initialStep={initialStep.success ? initialStep.data : undefined} />
    </div>
  );
}
