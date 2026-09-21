'use client';
import Link from 'next/link';
import { resolveAdminCapabilitySnapshot } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { usePerformanceDrafts } from '@/hooks/use-performance-preparation';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';

export function PerformanceDraftList() {
  const user = useAuthStore((state) => state.user);
  const capabilities = resolveAdminCapabilitySnapshot(user);
  const enabled = capabilities.superuser || capabilities.capabilities.includes('event.write');
  const drafts = usePerformanceDrafts(undefined, enabled);
  if (!enabled) return null;
  return <section aria-label="작성 중인 내 초안" className="mb-7 rounded-lg border border-gray-200 p-4">
    <h2 className="font-semibold">작성 중인 내 초안</h2>
    {drafts.isError ? <p role="alert" className="mt-2 text-sm">초안을 조회하지 못했습니다. <button className="underline" onClick={() => void drafts.refetch()}>다시 불러오기</button></p>
      : drafts.isPending ? <p className="mt-2 text-sm text-gray-500">불러오는 중</p>
        : drafts.data?.length ? <ul className="mt-2 divide-y">{drafts.data.map((draft) => <li className="flex flex-wrap justify-between gap-3 py-3 text-sm" key={draft.id}>
          <span>{draft.title}<span className="ml-3 text-gray-500">{formatAdminKstDateTime(draft.updatedAt).replace('T', ' ')} KST</span></span>
          <Link className="font-semibold text-violet-700" href={`${draft.performanceId ? `/admin/performances/${draft.performanceId}/edit` : '/admin/performances/new'}?draftId=${draft.id}`}>초안 이어 쓰기 ›</Link>
        </li>)}</ul> : <p className="mt-2 text-sm text-gray-500">작성 중인 초안이 없습니다.</p>}
  </section>;
}
