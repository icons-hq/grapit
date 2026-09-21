'use client';

import { PerformanceForm } from '@/components/admin/performance-form';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePerformanceDraft } from '@/hooks/use-performance-preparation';

export default function AdminPerformanceNewPage() {
  const draftId = useSearchParams().get('draftId') ?? '';
  const draft = usePerformanceDraft(draftId);
  if (draftId && draft.isPending) return <p>초안을 불러오고 있습니다.</p>;
  if (draftId && (draft.isError || !draft.data)) return <p role="alert">초안을 불러오지 못했습니다. <button className="underline" onClick={() => void draft.refetch()}>다시 불러오기</button></p>;
  if (draft.data?.appliedAt || draft.data?.performanceId) return <Link href={`/admin/performances/${draft.data.performanceId}`}>연결된 공연의 준비 화면 열기</Link>;
  return (
    <div>
      <h1 className="mb-6 text-display font-semibold leading-[1.2]">
        공연 등록
      </h1>
      <PerformanceForm key={draftId || 'new'} mode="create" initialDraft={draft.data} />
    </div>
  );
}
