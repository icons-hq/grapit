'use client';
import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import type { AnalyticsSessionDetail, AnalyticsVisitorSession } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
const Replay = dynamic(() => import('./analytics-replay-player'), { ssr: false, loading: () => <p>재생기 준비 중…</p> });
const time = (v: string) => formatAdminKstDateTime(v).replace('T', ' ');
const names: Record<string, string> = { page_view:'페이지 방문', pointer_click:'클릭·터치', link_click:'링크 이동', scroll_depth:'스크롤', engagement:'체류', performance_view:'공연 조회', booking_start:'예매 진입', seat_select:'좌석 선택', checkout_start:'결제 시작', signup_start:'가입 시작', queue_enter:'대기열 진입' };

export function AnalyticsVisitorsPanel({ since, until }: { since: string; until: string }) {
  const [before, setBefore] = useState<string>(); const [visitor, setVisitor] = useState<string>(); const [selected, setSelected] = useState<string>();
  const list = useQuery({ queryKey: ['admin','analytics','visitors',since,until,before,visitor], queryFn: () => {
    const query = new URLSearchParams({ since,until }); if (before) query.set('before',before); if (visitor) query.set('visitor',visitor);
    return apiClient.get<{ sessions: AnalyticsVisitorSession[]; nextBefore: string | null }>(`/api/v1/admin/analytics/visitors?${query}`, { showErrorToast: false });
  }, staleTime: 30000 });
  return <section className="admin-panel min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="admin-panel-title">개인별 방문·행동·화면 재생</h2><p className="admin-panel-description">동의한 브라우저의 세션과 확인된 회원 연결 · 최근 방문 순 · 비회원도 브라우저별로 구분</p></div>
      {visitor && <Button variant="outline" size="sm" onClick={() => { setVisitor(undefined); setBefore(undefined); }}>전체 방문자</Button>}</div>
    {list.isPending ? <p role="status">개인별 방문 불러오는 중…</p> : list.isError ? <p role="alert">개인별 방문을 불러오지 못했습니다. <Button size="sm" onClick={() => void list.refetch()}>다시 시도</Button></p> : <>
      <Table><TableHeader><TableRow><TableHead>방문자 / 회원</TableHead><TableHead>방문 시각 (KST)</TableHead><TableHead>기기 / 유입</TableHead><TableHead>행동 / 클릭 / 재생</TableHead><TableHead>상세</TableHead></TableRow></TableHeader><TableBody>
        {list.data.sessions.length ? list.data.sessions.map((session) => <TableRow key={session.id} data-state={selected === session.id ? 'selected' : undefined}>
          <TableCell className="max-w-60 whitespace-normal break-all"><button className="text-left text-sm underline" onClick={() => { setVisitor(session.visitorKey); setBefore(undefined); }}>{session.memberName || `비회원 ${session.visitorKey.slice(0,8)}`}</button>{session.memberEmail && <p className="mt-1 text-xs text-muted-foreground">{session.memberEmail}</p>}<p className="text-xs text-muted-foreground">브라우저 {session.visitorKey.slice(0,8)}</p></TableCell>
          <TableCell>{time(session.startedAt)}<p className="text-xs text-muted-foreground">마지막 {time(session.lastSeenAt)}</p></TableCell>
          <TableCell>{session.device} · {session.browser}<p className="max-w-56 truncate text-xs text-muted-foreground">{session.touch.source || '직접'} · {session.touch.campaign || session.touch.landingPath}</p></TableCell>
          <TableCell>{session.events} / {session.clicks} / {session.recordings}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setSelected(session.id)}>행동 보기</Button></TableCell>
        </TableRow>) : <TableRow><TableCell colSpan={5}>이 기간에 동의 후 수집된 개인별 방문이 없습니다.</TableCell></TableRow>}
      </TableBody></Table>
      <div className="flex gap-2">{before && <Button variant="outline" size="sm" onClick={() => setBefore(undefined)}>최신 방문</Button>}{list.data.nextBefore && <Button variant="outline" size="sm" onClick={() => setBefore(list.data.nextBefore!)}>이전 방문 50개</Button>}</div>
    </>}
    {selected && <SessionDetail key={selected} id={selected} onClose={() => setSelected(undefined)} />}
  </section>;
}
function SessionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [before, setBefore] = useState<string>(); const [recording, setRecording] = useState<string>(); const [page, setPage] = useState('');
  const detail = useQuery({ queryKey:['admin','analytics','session',id,before], queryFn:() => apiClient.get<AnalyticsSessionDetail>(`/api/v1/admin/analytics/sessions/${id}${before ? `?before=${encodeURIComponent(before)}` : ''}`, { showErrorToast:false }) });
  const clicks = useMemo(() => detail.data?.events.filter((e) => e.name === 'pointer_click') ?? [], [detail.data]);
  const pages = [...new Set(clicks.map((e) => `${e.path}|${Math.round(Number(e.props.viewportWidth)/100)*100}`))];
  const selectedPage = pages.includes(page) ? page : pages[0];
  const points = clicks.filter((e) => `${e.path}|${Math.round(Number(e.props.viewportWidth)/100)*100}` === selectedPage);
  if (detail.isPending) return <p role="status">행동 기록 불러오는 중…</p>;
  if (detail.isError) return <p role="alert">행동 기록을 불러오지 못했습니다. <Button size="sm" onClick={() => void detail.refetch()}>다시 시도</Button></p>;
  const data = detail.data;
  return <section className="min-w-0 space-y-5 border-t pt-5">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{data.session.memberName || `방문자 ${data.session.visitorKey.slice(0,8)}`} · {time(data.session.startedAt)}</h3><Button variant="ghost" size="sm" onClick={onClose}>닫기</Button></div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <div className="min-w-0 space-y-3"><h4 className="text-sm font-semibold">클릭·터치 히트맵</h4>
        {pages.length ? <><label className="block text-xs">페이지 · 화면 너비<select aria-label="히트맵 페이지" className="mt-2 block w-full rounded border bg-background p-2 text-sm" value={selectedPage} onChange={(e) => setPage(e.target.value)}>{pages.map((value) => <option key={value} value={value}>{value.replace('|',' · 약 ')}px</option>)}</select></label>
          <div className="relative h-96 overflow-hidden rounded border bg-muted/40" aria-label={`클릭 위치 히트맵 ${points.length}건`}>
            <div className="absolute inset-0 grid grid-cols-4">{[0,1,2,3].map((x) => <div key={x} className="border-r border-dashed border-border/70" />)}</div>
            {points.map((e) => <span key={e.id} title={`${e.props.pointer} · ${e.props.element} · (${e.props.x}, ${e.props.y})`} className="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{left:`${Math.min(100,Number(e.props.x)/Number(e.props.documentWidth)*100)}%`,top:`${Math.min(100,Number(e.props.y)/Number(e.props.documentHeight)*100)}%`,background:'radial-gradient(circle, rgba(239,68,68,.7), rgba(251,191,36,.3) 45%, transparent 75%)'}} />)}
            <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-xs">문서 상단</span><span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-1 text-xs">문서 하단 · {points.length}회</span>
          </div><p className="text-xs text-muted-foreground">문서 전체 크기로 정규화한 위치 분포입니다. 같은 페이지·비슷한 화면 너비끼리 표시하며, 실제 당시 화면은 아래 리플레이에서 확인합니다. 현재 타임라인 최대 500건 범위입니다.</p></> : <p className="text-sm text-muted-foreground">저장된 클릭·터치 좌표가 없습니다.</p>}
      </div>
      <div className="min-w-0 space-y-3"><h4 className="text-sm font-semibold">시간순 행동</h4><div className="max-h-[500px] overflow-auto rounded border"><ol className="divide-y">{data.events.map((event) => <li key={event.id} className="space-y-1 p-3 text-sm"><p className="flex flex-wrap justify-between gap-2"><strong>{names[event.name] || event.name}</strong><time className="text-xs text-muted-foreground">{time(event.occurredAt)}</time></p><p className="break-all text-xs">{event.path}</p>{Object.keys(event.props).length > 0 && <p className="break-words text-xs text-muted-foreground">{event.name === 'pointer_click' ? `${event.props.pointer} · ${event.props.element} · ${event.props.label} · (${event.props.x}, ${event.props.y})px · 화면 ${event.props.viewportWidth}×${event.props.viewportHeight}` : Object.entries(event.props).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p>}</li>)}</ol></div>
        <div className="flex gap-2">{before && <Button variant="outline" size="sm" onClick={() => setBefore(undefined)}>최신 행동</Button>}{data.nextBefore && <Button variant="outline" size="sm" onClick={() => setBefore(data.nextBefore!)}>이전 행동</Button>}</div>
      </div>
    </div>
    <div className="min-w-0 space-y-3"><h4 className="text-sm font-semibold">세션 리플레이 · 14일 보관</h4><div className="flex flex-wrap gap-2">{data.recordings.length ? data.recordings.map((r) => <Button key={r.id} size="sm" className="h-auto max-w-full whitespace-normal break-all py-2 text-left" variant={recording === r.id ? 'default' : 'outline'} onClick={() => setRecording(r.id)}>{time(r.startedAt)} · {r.path} · {r.events}프레임</Button>) : <p className="text-sm text-muted-foreground">재생 기록이 없습니다. 동의 전·민감 화면·수집 실패·보관 기간 경과 시 기록되지 않습니다.</p>}</div>{recording && <Replay key={recording} recordingId={recording} />}</div>
  </section>;
}
