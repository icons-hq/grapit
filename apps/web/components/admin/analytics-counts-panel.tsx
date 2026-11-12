'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AnalyticsReport } from '@grabit/shared';
import { Activity, Eye, UserPlus, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminStatCard } from './admin-stat-card';
import { apiClient } from '@/lib/api-client';
import { aggregateEventLabels } from '@/lib/analytics-counts-client';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';

const pageLabels: Record<string, string> = { home: '홈', performance: '공연', booking: '예매', auth: '로그인·가입', search: '검색', support: '고객센터', other: '기타 공개 화면' };
export function AnalyticsCountsPanel({ data, canControl }: { data: AnalyticsReport; canControl: boolean }) {
  const client = useQueryClient();
  const control = useMutation({ mutationFn: (enabled: boolean) => apiClient.put('/api/v1/admin/analytics/aggregate-settings', { enabled }, { showErrorToast: false }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['admin', 'analytics'] }); await client.invalidateQueries({ queryKey: ['analytics', 'config'] }); },
  });
  const counts = data.aggregate?.counts ?? []; const history = data.aggregate?.history ?? [];
  const total = (name: string) => counts.filter((r) => r.name === name).reduce((sum, r) => sum + r.count, 0);
  const edge = history.filter((r) => r.source === 'cloudflare_zone');
  const hours = [...new Set(history.map((r) => r.hour))].sort();
  const observed = history.map((r) => r.observedThrough).sort().at(-1);
  const edgeValue = (hour: string, metric: string) => edge.find((r) => r.hour === hour && r.metric === metric)?.count;
  return <section className="admin-panel flex flex-col gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="admin-panel-title">접속·행동 횟수와 실제 가입</h2><p className="mt-1 text-sm text-muted-foreground">개인 식별자·회원 연결 없이 시간별 합계만 저장합니다. 방문자 수나 전환율이 아닙니다.</p></div>
      <div className="flex items-center gap-2"><Badge variant={data.config.aggregateEnabled ? 'default' : 'secondary'}>{data.config.aggregateEnabled ? '횟수 집계 중' : '횟수 집계 중지'}</Badge>
        {canControl && <Button variant={data.config.aggregateEnabled ? 'destructive' : 'outline'} size="sm" disabled={!data.config.aggregateEnvironmentEnabled || control.isPending} onClick={() => control.mutate(!data.config.aggregateEnabled)}>{data.config.aggregateEnabled ? '횟수 집계 중단' : '횟수 집계 시작'}</Button>}</div>
    </div>
    {control.isError && <p role="alert" className="text-sm text-destructive">설정을 변경하지 못했습니다. 새로고침 후 확인해주세요.</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <AdminStatCard label="기존 HTML 요청 · Cloudflare" value={edge.filter((r) => r.metric === 'html_page_views').reduce((sum, r) => sum + r.count, 0)} format="count" icon={Eye} description="전체 도메인 · 봇·모니터링 포함" />
      <AdminStatCard label="새 페이지 표시 · 브라우저" value={total('page_view')} format="count" icon={Activity} description="집계 시작 이후 · 중복 방문 포함" />
      <AdminStatCard label="실제 신규 가입" value={data.summary.signups} format="count" icon={UserPlus} description="선택한 기간 · DB 가입 시각" />
      <AdminStatCard label="실제 결제 완료" value={data.summary.paidOrders} format="count" icon={Ticket} description="선택한 기간 · DB 승인 시각" />
    </div>
    <p className="text-xs leading-6 text-muted-foreground">두 페이지 지표는 수집 위치와 범위가 달라 합산하지 않습니다. 기존 요청 기록으로 과거 클릭·스크롤·회원별 경로를 복원할 수 없습니다. 브라우저 차단·거부·네트워크 오류·부하 제한으로 새 집계는 누락될 수 있습니다. 시간별 집계이므로 조회 시작 시각이 포함된 시간대 전체를 표시합니다.</p>
    <div><h3 className="mb-2 text-sm font-semibold">어제부터의 기존 접속 기록</h3>
      <p className="mb-3 text-xs text-muted-foreground">Cloudflare 저장 집계{observed ? ` · ${formatAdminKstDateTime(observed).replace('T', ' ')} KST 조회 기준` : ''}. 마지막 시간대는 일부 구간일 수 있습니다. 공개 사이트 추정치는 샘플링을 포함합니다.</p>
      <Table><TableHeader><TableRow><TableHead>한국 시간</TableHead><TableHead>전체 HTTP 요청</TableHead><TableHead>HTML 요청</TableHead><TableHead>공개 사이트 HTML 추정</TableHead></TableRow></TableHeader>
        <TableBody>{hours.length ? hours.map((hour) => <TableRow key={hour}><TableCell>{hour}</TableCell><TableCell>{edgeValue(hour, 'requests')?.toLocaleString() ?? '—'}</TableCell><TableCell>{edgeValue(hour, 'html_page_views')?.toLocaleString() ?? '—'}</TableCell><TableCell>{history.find((r) => r.hour === hour && r.source === 'cloudflare_public_html')?.count.toLocaleString() ?? '—'}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4}>해당 구간의 확보된 접속 집계가 없습니다.</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    <div><h3 className="mb-2 text-sm font-semibold">집계 시작 이후 행동 횟수</h3>
      <p className="mb-3 text-xs text-muted-foreground">최근 수신 {data.aggregate?.updatedAt ? `${formatAdminKstDateTime(data.aggregate.updatedAt).replace('T', ' ')} KST` : '아직 없음'}. 같은 사람의 반복 동작을 구분하지 않습니다.</p>
      <Table><TableHeader><TableRow><TableHead>한국 시간</TableHead><TableHead>화면</TableHead><TableHead>동작</TableHead><TableHead>횟수</TableHead></TableRow></TableHeader><TableBody>{counts.length ? counts.map((row) => <TableRow key={`${row.hour}:${row.page}:${row.name}`}><TableCell>{row.hour}</TableCell><TableCell>{pageLabels[row.page]}</TableCell><TableCell>{aggregateEventLabels[row.name]}</TableCell><TableCell>{row.count.toLocaleString()}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4}>아직 집계된 동작이 없습니다.</TableCell></TableRow>}</TableBody></Table>
    </div>
  </section>;
}
