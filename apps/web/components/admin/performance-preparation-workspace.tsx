'use client';

import Link from 'next/link';
import { Check, CircleAlert, Info } from 'lucide-react';
import { useAdminEventContext } from './admin-event-context';
import { usePerformanceDrafts, usePerformancePreparation } from '@/hooks/use-performance-preparation';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';
import { useAuthStore } from '@/stores/use-auth-store';
import { resolveAdminCapabilitySnapshot } from '@grabit/shared';
import { Button } from '@/components/ui/button';

export function PerformancePreparationWorkspace({ id }: { id: string }) {
  const user = useAuthStore((state) => state.user);
  const capability = resolveAdminCapabilitySnapshot(user);
  const canWrite = capability.superuser || capability.capabilities.includes('event.write');
  const preparation = usePerformancePreparation(id, canWrite);
  const drafts = usePerformanceDrafts(id, canWrite);
  const context = useAdminEventContext();
  const href = (path: string) => context?.href(path) ?? path;
  if (!canWrite) return <p role="alert">공연 준비 권한이 없습니다. 허용된 업무 메뉴를 선택해주세요.</p>;
  if (preparation.isPending) return <p role="status">공연 준비 상태를 불러오고 있습니다.</p>;
  if (preparation.isError || !preparation.data) return <div role="alert"><p>공연 준비 상태를 조회하지 못했습니다.</p><Button onClick={() => void preparation.refetch()}>다시 불러오기</Button></div>;
  const data = preparation.data;
  const missing = data.checks.filter((check) => !check.ready);
  return <div className="space-y-8 text-gray-950">
    <div><p className="mb-2 text-sm font-medium text-gray-500">공연 운영</p>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">공연을 준비하고 운영하세요</h1>
      <p className="mt-3 text-gray-600">{data.title} · 준비 상태를 확인하고 다음 업무를 이어갑니다.</p></div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-8">
        <section aria-labelledby="preparation-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="preparation-heading" className="text-xl font-bold">판매 준비</h2>
            <Button asChild><Link href={href(`/admin/performances/${id}/edit?step=review`)}>검수하기</Link></Button></div>
          <ul className="divide-y border-y border-gray-200">
            {data.checks.map((check) => <li key={check.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 py-5 sm:items-center">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${check.ready ? 'bg-emerald-600' : 'bg-amber-600'}`}>
                {check.ready ? <Check size={18} /> : <CircleAlert size={18} />}</span>
              <div className="grid gap-1 lg:grid-cols-[150px_minmax(0,1fr)]"><span className="text-sm font-semibold">{check.label}</span><span className="text-sm leading-6 text-gray-500">{check.key === 'sales' && data.bookingStartsAt ? `판매 시작 ${formatAdminKstDateTime(data.bookingStartsAt).replace('T', ' ')} KST` : check.detail}</span></div>
              <Link className="text-sm font-medium text-violet-700 underline-offset-4 hover:underline" href={href(`/admin/performances/${id}/edit?step=${check.step}`)}>
                <span className={`mr-4 hidden sm:inline ${check.ready ? 'text-emerald-700' : 'text-amber-700'}`}>{check.ready ? '준비됨' : '확인 필요'}</span>수정<span className="sr-only">: {check.label}</span> ›</Link>
            </li>)}
          </ul>
        </section>
        <section><h2 className="mb-4 text-xl font-bold">지금 처리할 일</h2>
          {missing.length ? <ul className="divide-y rounded-lg border border-gray-200">{missing.map((check) => <li key={check.key} className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>{check.label} 확인</span><Link href={href(`/admin/performances/${id}/edit?step=${check.step}`)} className="font-medium text-violet-700">이어서 준비 ›</Link>
          </li>)}</ul> : <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{data.publishState === 'published' ? '공연이 공개됐습니다. 판매 시작 시각과 예매 현황을 확인해주세요.' : '공개 전 필수 정보가 준비됐습니다. 승인 담당자가 검수 화면에서 공개할 수 있습니다.'}</p>}
        </section>
        <section><h2 className="mb-4 text-lg font-bold">작성 중인 내 초안</h2>
          {drafts.isError ? <p role="alert">초안을 조회하지 못했습니다. <button onClick={() => void drafts.refetch()} className="underline">다시 불러오기</button></p>
            : drafts.isPending ? <p>초안 불러오는 중</p> : drafts.data?.length ? <ul className="divide-y rounded-lg border">{drafts.data.map((draft) => <li key={draft.id} className="flex flex-wrap justify-between gap-3 p-4 text-sm">
              <span>{draft.title} · {formatAdminKstDateTime(draft.updatedAt).replace('T', ' ')} KST</span><Link className="font-medium text-violet-700" href={href(`/admin/performances/${id}/edit?draftId=${draft.id}`)}>초안 이어 쓰기 ›</Link>
            </li>)}</ul> : <p className="text-sm text-gray-500">작성 중인 초안이 없습니다.</p>}
        </section>
        <section><h2 className="mb-4 text-lg font-bold">저장·공개 기록</h2>
          <ul className="divide-y rounded-lg border border-gray-200">{data.history.length ? data.history.map((entry) => <li key={entry.id} className="grid gap-1 p-3 text-sm sm:grid-cols-[160px_minmax(0,1fr)]">
            <time className="text-gray-500">{formatAdminKstDateTime(entry.createdAt).replace('T', ' ')} KST</time><span>{entry.reason || (entry.action === 'event.publish' ? '공개 검수' : '공연 변경')} · {entry.status === 'success' ? '완료' : entry.status === 'failed' ? '준비 미완료' : '권한 제한'}</span>
          </li>) : <li className="p-4 text-sm text-gray-500">기록된 변경이 없습니다.</li>}</ul>
        </section>
      </div>
      <aside className="h-fit rounded-lg border border-gray-200 bg-slate-50 p-5 text-sm leading-7">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-bold"><Info size={20} className="text-blue-600" />판매 전 확인</h2>
        <p className="font-semibold">게시와 판매 시작은 구분됩니다.</p><p className="mt-2 text-gray-600">공개 후에도 판매 상태, 판매 시작 시각과 예매 허용 설정이 충족되어야 구매할 수 있습니다.</p>
        <dl className="my-5 border-y border-gray-200 py-4"><dt className="text-gray-500">현재 공개 상태</dt><dd className="font-semibold">{data.publishState === 'published' ? '공개됨' : '비공개 준비 중'}</dd><dt className="mt-3 text-gray-500">판매 시작 · 한국 시간</dt><dd>{data.bookingStartsAt ? `${formatAdminKstDateTime(data.bookingStartsAt).replace('T', ' ')} KST` : '시각 미지정'}</dd></dl>
        {data.publishState === 'published' ? <Link href={`/performance/${id}`} className="font-semibold text-violet-700">구매자 화면 보기 ↗</Link> : <p className="text-gray-600">준비 중인 공연은 공개 승인 후 구매자 화면에 나타납니다.</p>}
        {(capability.superuser || capability.capabilities.includes('benefits.manage')) && <Link href={href('/admin/benefits')} className="mt-3 block font-semibold text-violet-700">회차별 특전 설정 확인 ›</Link>}
      </aside>
    </div>
  </div>;
}
