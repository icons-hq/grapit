'use client';
import { useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { Users, TrendingUp, Ticket, RefreshCw } from 'lucide-react';
import type { SignupMonitoringQuery, SignupMonitoringResponse } from '@grabit/shared';
import { AdminStatCard } from './admin-stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAdminKstDateTime, parseAdminKstDateTimeInput } from '@/lib/admin-datetime';
import { useSignupMonitoring } from '@/hooks/use-signup-monitoring';
import { readAnnouncement, saveAnnouncement, subscribeAnnouncement } from '@/lib/admin-announcement';

const Chart = dynamic(() => import('./signup-monitoring-chart'), { ssr: false, loading: () => <Skeleton className="h-[230px] w-full" /> });
const providerNames: Record<string, string> = { email: '이메일', kakao: '카카오', naver: '네이버', google: 'Google', unknown: '확인 불가' };
const kst = (value: string) => formatAdminKstDateTime(value).replace('T', ' ');
const percent = (count: number, total: number) => total ? (100 * count / total).toFixed(1) : '0.0';
const noSavedAnnouncement = () => null;

export function SignupMonitoringPanel() {
  const [period, setPeriod] = useState<SignupMonitoringQuery['period']>('today');
  const storedAnnouncement = useSyncExternalStore(subscribeAnnouncement, readAnnouncement, noSavedAnnouncement);
  const [appliedAnnouncement, setAnnouncement] = useState<string | null>(null);
  const announcement = appliedAnnouncement ?? storedAnnouncement ?? new Date(formatAdminKstDateTime(new Date().toISOString()).slice(0, 10) + 'T00:00:00+09:00').toISOString();
  const [editedDraft, setDraft] = useState<string | null>(null);
  const draft = editedDraft ?? formatAdminKstDateTime(announcement).slice(0, 16);
  const [validation, setValidation] = useState('');
  const query = useSignupMonitoring({ period, ...(period === 'announcement' && announcement ? { since: announcement } : {}) });
  function applyAnnouncement(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseAdminKstDateTimeInput(draft, { min: 2020, max: 2100 });
    const age = parsed ? Date.now() - Date.parse(parsed) : -1;
    if (!parsed || age < 0 || age > 90 * 86400000) { setValidation('현재 이전, 최근 90일 이내의 공지 시각을 입력해주세요.'); return; }
    setValidation(''); setAnnouncement(parsed); setPeriod('announcement');
    saveAnnouncement(parsed);
  }
  return <section className="admin-panel flex flex-col gap-5" aria-labelledby="signup-monitor-heading">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="signup-monitor-heading" className="admin-panel-title">공지 이후 가입 모니터링</h2><p className="admin-panel-description">한국 시간 기준 · 이 화면을 보는 동안 60초마다 자동 갱신</p></div>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw data-icon="inline-start" />새로고침</Button>
    </div>
    <div className="flex flex-col gap-4">
      <ToggleGroup type="single" value={period} onValueChange={(value) => { if (value) setPeriod(value as SignupMonitoringQuery['period']); }} aria-label="가입 모니터링 기간" className="flex flex-wrap justify-start">
        <ToggleGroupItem value="announcement">공지 시각 이후</ToggleGroupItem><ToggleGroupItem value="today">오늘 00:00 이후</ToggleGroupItem><ToggleGroupItem value="24h">최근 24시간</ToggleGroupItem><ToggleGroupItem value="7d">최근 7일</ToggleGroupItem>
      </ToggleGroup>
      <form onSubmit={applyAnnouncement} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2"><Label htmlFor="announcement-at">공지 시각 (KST)</Label><Input id="announcement-at" type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={!!validation} aria-describedby="announcement-hint" required /></div>
        <Button type="submit" variant="secondary">기준 시각 적용</Button>
        <p id="announcement-hint" className="text-xs text-muted-foreground">기본값: 오늘 00:00 · 설정은 이 브라우저에 저장됩니다.</p>
      </form>
      {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
    </div>
    {query.isPending ? <div role="status" aria-label="가입 통계 불러오는 중" className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      : query.isError ? <div role="alert"><p>가입 통계를 불러오지 못했습니다. 이전 수치는 최신 결과로 표시하지 않습니다.</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>다시 시도</Button></div>
        : query.data ? <SignupMonitoringData data={query.data} /> : null}
    <p className="text-xs leading-6 text-muted-foreground">집계 기준: 일반 회원 가입만 포함합니다. 탈퇴 계정은 포함하고 병합 계정·관리자는 제외합니다. 영구 삭제된 회원은 집계할 수 없습니다. 인증·마케팅 동의는 조회 시점 상태입니다.</p>
  </section>;
}

function SignupMonitoringData({ data }: { data: SignupMonitoringResponse }) {
  const { summary: s } = data;
  const change = `${s.change > 0 ? '+' : ''}${s.change}명`;
  return <>
    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><p>집계: {kst(data.since)} ~ {kst(data.until)}</p><p>마지막 갱신: {kst(data.generatedAt)}</p></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <AdminStatCard label="신규 가입" icon={Users} value={s.signups} format="count" description="선택한 시각 이후 가입" />
      <AdminStatCard label="이전 구간 가입" icon={TrendingUp} value={s.previousSignups} format="count" description={`${change} · ${s.changeRate === null ? '이전 0명으로 증감률 미산출' : `${s.changeRate > 0 ? '+' : ''}${s.changeRate}%`}`} />
      <AdminStatCard label="첫 결제 전환 회원" icon={Ticket} value={s.firstPaidMembers} format="count" description="가입 후 결제 완료 예매 1건 이상" />
      <AdminStatCard label="가입 → 첫 결제 전환율" icon={TrendingUp} value={s.firstPaidRate} format="percent" description="첫 결제 전환 회원 ÷ 신규 가입" />
    </div>
    <p className="text-xs text-muted-foreground">비교 구간: {kst(data.previousSince)} ~ {kst(data.since)} (동일 길이). 첫 결제는 발권된 예매의 승인 시각 기준이며 이후 취소된 예매도 포함합니다.</p>
    <div><h3 className="mb-3 text-sm font-semibold">시간대별 신규 가입</h3>{s.signups === 0 && <p className="mb-3 text-sm text-muted-foreground">선택한 기간에 신규 가입이 없습니다.</p>}<Chart data={data.hourly} /></div>
    <div className="grid gap-4 sm:grid-cols-3">
      {([['이메일 인증 완료', s.emailVerified], ['휴대폰 인증 완료', s.phoneVerified], ['마케팅 수신 동의', s.marketingConsented]] as const).map(([label, count]) => <div key={label} className="rounded-md border border-border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold">{percent(count, s.signups)}% <span className="text-xs font-normal text-muted-foreground">{count} / {s.signups}명</span></p></div>)}
    </div>
    <div className="grid items-start gap-5 lg:grid-cols-3">
      <Distribution title="가입 방식 (추정)" rows={data.providers} names={providerNames} /><Distribution title="국가" rows={data.countries} /><Distribution title="언어" rows={data.locales} />
    </div>
    <p className="text-xs text-muted-foreground">가입 방식은 가입 직후 1분 이내 생성된 소셜 연결을 우선합니다. 이후 계정 연결·통합으로 실제 최초 가입 방식과 다를 수 있습니다. 방문 경로는 이 단계에서 수집하지 않습니다.</p>
    <details><summary className="cursor-pointer text-sm">시간대별 수치 보기</summary><div className="mt-3 max-h-64 overflow-auto"><Table><TableHeader><TableRow><TableHead>시간대 (KST)</TableHead><TableHead>가입</TableHead></TableRow></TableHeader><TableBody>{data.hourly.map((row) => <TableRow key={row.hour}><TableCell>{row.hour}</TableCell><TableCell>{row.signups}명</TableCell></TableRow>)}</TableBody></Table></div></details>
  </>;
}
function Distribution({ title, rows, names = {} }: { title: string; rows: SignupMonitoringResponse['providers']; names?: Record<string, string> }) {
  return <div><h3 className="mb-2 text-sm font-semibold">{title}</h3><Table><TableHeader><TableRow><TableHead>구분</TableHead><TableHead>가입</TableHead><TableHead>비율</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map((r) => <TableRow key={r.value}><TableCell>{names[r.value] ?? r.value}</TableCell><TableCell>{r.count}명</TableCell><TableCell>{r.rate.toFixed(1)}%</TableCell></TableRow>) : <TableRow><TableCell colSpan={3}>집계 없음</TableCell></TableRow>}</TableBody></Table></div>;
}
