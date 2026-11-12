'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Eye, Activity, Ticket, RefreshCw, UserPlus } from 'lucide-react';
import { resolveAdminCapabilitySnapshot, type AnalyticsReport } from '@grabit/shared';
import { AnalyticsVisitorsPanel } from './analytics-visitors-panel';
import { AnalyticsCountsPanel } from './analytics-counts-panel';
import { AdminPageHeader } from './admin-page-header';
import { AdminStatCard } from './admin-stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { formatAdminKstDateTime, parseAdminKstDateTimeInput } from '@/lib/admin-datetime';
import { useAuthStore } from '@/stores/use-auth-store';
import { readAnnouncement, saveAnnouncement, subscribeAnnouncement } from '@/lib/admin-announcement';

const Chart = dynamic(() => import('./analytics-chart'), { ssr: false, loading: () => <Skeleton className="h-[260px] w-full" /> });
const kst = (value: string | null) => value ? formatAdminKstDateTime(value).replace('T', ' ') : '아직 없음';
type Period = 'yesterday' | 'today' | '7d' | '30d' | 'announcement';
function startOfKstDay(now: number) { return Math.floor((now + 32400000) / 86400000) * 86400000 - 32400000; }
const noSavedAnnouncement = () => null;
export function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>('yesterday'); const [granularity, setGranularity] = useState<'hour' | 'day'>('hour');
  const savedAnnouncement = useSyncExternalStore(subscribeAnnouncement, readAnnouncement, noSavedAnnouncement);
  const [selectedAnnouncement, setAnnouncement] = useState<string | null>(null);
  const [defaultAnnouncement] = useState(() => new Date(startOfKstDay(Date.now())).toISOString());
  const announcement = selectedAnnouncement ?? savedAnnouncement ?? defaultAnnouncement;
  const [editedDraft, setDraft] = useState<string | null>(null);
  const draft = editedDraft ?? formatAdminKstDateTime(announcement).slice(0, 16);
  const [error, setError] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
  const user = useAuthStore((s) => s.user); const caps = resolveAdminCapabilitySnapshot(user);
  const canControl = caps.superuser || caps.capabilities.includes('security.manage');
  const client = useQueryClient();
  const report = useQuery({ queryKey: ['admin', 'analytics', period, announcement, granularity],
    queryFn: () => { const now = Date.now(); const since = period === 'announcement' ? announcement : new Date(startOfKstDay(now) - (period === 'yesterday' ? 1 : period === '7d' ? 6 : period === '30d' ? 29 : 0) * 86400000).toISOString();
      const params = new URLSearchParams({ since, until: new Date(now).toISOString(), granularity }); return apiClient.get<AnalyticsReport>(`/api/v1/admin/analytics?${params}`, { showErrorToast: false }); },
    staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false,
  });
  const settings = useMutation({ mutationFn: (enabled: boolean) => apiClient.put('/api/v1/admin/analytics/settings', { enabled, policyAcknowledged: enabled && acknowledged }, { showErrorToast: false }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['admin', 'analytics'] }); await client.invalidateQueries({ queryKey: ['analytics', 'config'] }); },
  });
  function apply(event: React.FormEvent) {
    event.preventDefault(); const value = parseAdminKstDateTimeInput(draft, { min: 2020, max: 2100 });
    if (!value || Date.parse(value) >= Date.now() || Date.parse(value) < Date.now() - 90 * 86400000) { setError('현재 이전, 최근 90일 이내의 시각을 입력해주세요.'); return; }
    setError(''); setAnnouncement(value); saveAnnouncement(value); setPeriod('announcement');
  }
  const data = report.isError ? undefined : report.data;
  return <div className="flex min-w-0 flex-col gap-6">
    <AdminPageHeader title="방문·가입 분석" description="기존 접속 기록·새 행동 횟수와 실제 가입·결제를 확인합니다. 한국 시간 기준 · 60초 자동 갱신"
      actions={<Button variant="outline" onClick={() => void report.refetch()} disabled={report.isFetching}><RefreshCw data-icon="inline-start" />새로고침</Button>} />
    <section className="admin-panel flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><ToggleGroup type="single" value={period} onValueChange={(v) => { if (v) { setPeriod(v as Period); setGranularity(v === 'today' || v === 'yesterday' || v === 'announcement' ? 'hour' : 'day'); } }} aria-label="분석 기간">
        <ToggleGroupItem value="yesterday">어제부터</ToggleGroupItem><ToggleGroupItem value="today">오늘</ToggleGroupItem><ToggleGroupItem value="7d">7일</ToggleGroupItem><ToggleGroupItem value="30d">30일</ToggleGroupItem><ToggleGroupItem value="announcement">공지 이후</ToggleGroupItem></ToggleGroup>
        <ToggleGroup type="single" value={granularity} onValueChange={(v) => { if (v) setGranularity(v as 'hour' | 'day'); }} aria-label="추이 단위"><ToggleGroupItem value="hour">시간별</ToggleGroupItem><ToggleGroupItem value="day">일별</ToggleGroupItem></ToggleGroup>
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={apply}><div className="flex flex-col gap-2"><Label htmlFor="analytics-since">공지 기준 시각 (KST)</Label><Input id="analytics-since" type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} required aria-invalid={!!error} /></div><Button type="submit" variant="secondary">적용</Button></form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data && <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><p>{kst(data.since)} ~ {kst(data.until)}</p><p>마지막 갱신: {kst(data.generatedAt)}</p></div>}
    </section>
    {report.isPending ? <div role="status" aria-label="방문 분석 불러오는 중" className="grid grid-cols-2 gap-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      : report.isError ? <section role="alert" className="admin-panel"><p>방문 분석을 불러오지 못했습니다. 기간을 줄이거나 잠시 후 다시 시도해주세요.</p><Button className="mt-3" variant="outline" onClick={() => void report.refetch()}>다시 시도</Button></section> : null}
    {data && <>
      <AnalyticsCountsPanel data={data} canControl={canControl} />
      <h2 className="text-lg font-semibold">선택 동의 기반 개인별 방문 연결</h2>
      <section className="admin-panel flex flex-col gap-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Badge variant={data.config.enabled ? 'default' : 'secondary'}>{data.config.enabled ? '개인별 방문 연결 중' : '개인별 방문 연결 중지'}</Badge><span className="text-xs text-muted-foreground">최근 수신 {kst(data.lastCollectedAt)}</span></div>
        {canControl && data.config.enabled && <Button variant="destructive" size="sm" disabled={settings.isPending} onClick={() => settings.mutate(false)}>수집 즉시 중단</Button>}</div>
        {!data.config.enabled && <p className="text-sm text-muted-foreground">개인별 방문 연결이 중지되어 UV·세션·전환 퍼널은 집계하지 않습니다. 위의 식별자 없는 횟수 집계는 별도입니다. 신규 가입·결제·취소는 기존 DB 기록으로 계속 확인할 수 있습니다.</p>}
        {canControl && !data.config.enabled && <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} disabled={!data.config.environmentEnabled} />선택기능 안내 게시·동의 절차 확인</label><Button size="sm" variant="outline" disabled={!data.config.environmentEnabled || !acknowledged || settings.isPending} onClick={() => settings.mutate(true)}>수집 시작</Button>{!data.config.environmentEnabled && <p className="text-xs text-muted-foreground">선택기능 안내와 운영 환경 활성화가 필요합니다.</p>}</div>}
        {settings.isError && <p role="alert" className="text-sm text-destructive">수집 설정 변경에 실패했습니다. 상태를 새로고침한 뒤 다시 시도해주세요.</p>}
      </section>
      {canControl && <AnalyticsVisitorsPanel since={data.since} until={data.until} />}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6"><AdminStatCard label="방문자 (UV)" value={data.summary.visitors} format="count" icon={Users} description={`이전 동일 구간 ${data.summary.previousVisitors.toLocaleString()} · 재방문 ${data.summary.returningVisitors.toLocaleString()}`} />
        <AdminStatCard label="세션" value={data.summary.sessions} format="count" icon={Activity} description="30분 무활동 시 새 세션" /><AdminStatCard label="페이지뷰" value={data.summary.pageViews} format="count" icon={Eye} description="동의 후 수집한 조회" />
        <AdminStatCard label="신규 가입 · DB" value={data.summary.signups} format="count" icon={UserPlus} description="방문 동의 여부와 무관" /><AdminStatCard label="결제 완료 · DB" value={data.summary.paidOrders} format="count" icon={Ticket} description={`기간 내 취소 예매 ${data.summary.cancelledOrders}건`} />
        {data.summary.activeVisitors === null ? <div className="admin-stat-card rounded-sm border border-border p-4"><p className="text-xs text-muted-foreground">최근 5분 활성 방문자</p><p className="mt-4 text-lg">확인 불가</p></div> : <AdminStatCard label="최근 5분 활성 방문자" value={data.summary.activeVisitors} format="count" icon={Activity} description="현재 시각 기준" />}</div>
      {data.summary.pageViews === 0 && <p className="text-sm text-muted-foreground">선택한 기간에 수집된 방문 기록이 없습니다. 수집 중지·동의 거부·차단·집계 전 방문은 0과 구분해 해석하세요.</p>}
      <Panel title="방문 추이" description="방문자와 페이지뷰 · 기간 UV는 중복 제거하며 일·시간별 UV를 합산하지 않습니다."><Chart data={data.trend} /><p className="mt-3 text-xs text-muted-foreground">시간·일별 집계 작업 최근 시각: {kst(data.rollupThrough)}. 최근 구간과 미집계 구간은 원본으로 보완합니다.</p></Panel>
      <div className="grid gap-6 xl:grid-cols-2"><Panel title="예매 퍼널" description="같은 세션·공연에서 순서대로 진행한 방문만 포함합니다."><Funnel rows={data.funnel} /></Panel><Panel title="방문 → 가입" description="로그인 연결이 확인된 방문과 DB 가입 시각을 대조합니다."><Funnel rows={data.signupFunnel} /><p className="mt-4 text-xs leading-6 text-muted-foreground">동의 거부·다른 기기·차단·결제 복귀 지연은 연결되지 않을 수 있습니다. 결제 연결은 마지막 방문 후 30분까지이며, 위 DB 전체 실적과 수집 범위가 다릅니다.</p>{canControl && <Link href="/admin/users" className="mt-4 inline-block text-sm underline">가입·인증·첫 결제 상세 보기</Link>}</Panel></div>
      <Panel title="유입 채널과 캠페인" description="방문 세션의 첫 진입 경로 · 가입과 결제는 확인된 연결만 표시합니다."><DataTable headers={['유입', '매체', '캠페인', '키워드 / 콘텐츠', '세션', '가입', '결제 회원']} rows={data.sources.map((r) => [r.source === 'direct' ? '직접 / 경로 없음' : r.source, r.medium || '—', r.campaign || '—', [r.term, r.content].filter(Boolean).join(' / ') || '—', r.sessions, r.signups, r.paidMembers])} /></Panel>
      <Panel title="가입 유입 기여도" description="처음 확인된 유입과 가입 시점 마지막 유입을 보존합니다. 광고의 인과 효과나 ROAS를 의미하지 않습니다."><DataTable headers={['기준', '유입', '캠페인', '가입', '결제 회원']} rows={data.attribution.map((r) => [r.model === 'first' ? '첫 유입' : '가입 직전 유입', r.source, r.campaign || '—', r.signups, r.paidMembers])} /></Panel>
      <div className="grid items-start gap-6 xl:grid-cols-2"><Panel title="랜딩 페이지" description="한 페이지만 본 세션은 관심 부족으로 단정하지 않습니다."><DataTable headers={['처음 본 페이지', '세션', '한 페이지 방문']} rows={data.landingPages.map((r) => [r.path, r.sessions, r.singlePageSessions])} /></Panel>
        <Panel title="많이 본 공연" description="조회에서 예매 진입·결제 시작으로 이어진 관심을 확인합니다."><DataTable headers={['공연', '조회', '예매 진입', '결제 시작']} rows={data.performances.map((r) => [r.title, r.views, r.bookingSessions, r.checkoutSessions])} /></Panel></div>
      <Panel title="페이지 관심과 마지막 방문" description="보이는 화면의 체류 시간과 75% 이상 스크롤. 마지막 페이지는 이탈의 근사치입니다."><DataTable headers={['페이지', '조회', '평균 체류', '깊은 스크롤', '마지막 페이지']} rows={data.engagement.map((r) => [r.path, r.views, `${r.averageSeconds}초`, r.deepScrolls, r.exits])} /></Panel>
      <Panel title="접속 환경" description="세부 모델·버전 없이 기기·브라우저·OS·언어·화면 구간만 기록합니다."><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{(['device', 'browser', 'os', 'language', 'screen'] as const).map((dimension, i) => <div key={dimension}><h3 className="mb-2 text-sm font-medium">{['기기', '브라우저', '운영체제', '언어', '화면'][i]}</h3><DataTable headers={['구분', '세션']} rows={data.dimensions.filter((r) => r.dimension === dimension).map((r) => [r.value, r.sessions])} /></div>)}</div></Panel>
      <p className="text-xs leading-6 text-muted-foreground">운영·마케팅 판단을 위한 관측치입니다. 봇·관리자·현장·민감 경로는 제외하며 분석 거부·네트워크 실패·용량 제한으로 누락될 수 있습니다. 원본·회원 연결은 90일, 식별자 없는 집계는 1년 보관합니다. DB 가입은 탈퇴 포함, 병합·관리자 제외 기준입니다. 결제 완료는 발권 예매의 승인, 취소는 좌석 부분 취소를 포함한 예매 수입니다.</p>
    </>}
  </div>;
}
function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <section className="admin-panel min-w-0"><h2 className="admin-panel-title">{title}</h2><p className="admin-panel-description mb-4">{description}</p>{children}</section>; }
function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <Table><TableHeader><TableRow>{headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length ? rows.map((row, i) => <TableRow key={i}>{row.map((cell, j) => <TableCell key={j} className={j === 0 ? 'max-w-64 whitespace-normal break-all' : undefined}>{cell}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={headers.length}>집계 없음</TableCell></TableRow>}</TableBody></Table>;
}
function Funnel({ rows }: { rows: AnalyticsReport['funnel'] }) { return <div className="flex flex-col gap-4">{rows.map((r) => <div key={r.name}><div className="mb-2 flex items-center justify-between gap-3 text-sm"><span>{r.name}</span><span className="tabular-nums">{r.count.toLocaleString()}세션 · {r.rate}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, r.rate)}%` }} /></div>{r.dropoff > 0 && <p className="mt-1 text-right text-xs text-muted-foreground">이전 단계 대비 {r.dropoff}세션 이탈</p>}</div>)}</div>; }
