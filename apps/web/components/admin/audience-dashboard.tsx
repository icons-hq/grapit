'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, Users, Mail, RefreshCw, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { resolveAdminCapabilitySnapshot, normalizeGa4Path, sanitizeAnalyticsCampaign, audienceTagInputSchema,
  type AudienceTag, type AudienceTagInput, type AudienceOverview, type AudienceProfile, type AudienceProfileSummary, type AudiencePerformance, type CreativeReport, type Ga4InterestReport, type Ga4Config } from '@grabit/shared';
import { AdminPageHeader } from './admin-page-header';
import { AdminStatCard } from './admin-stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { getFrontendOrigin } from '@/lib/frontend-origin';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';
import { useAuthStore } from '@/stores/use-auth-store';

const BASE = '/api/v1/admin/analytics/audience' as const;
const kinds = { artist: '아티스트', activity: '활동·취미', benefit: '소식·혜택' };
const when = (at: string | null) => at ? formatAdminKstDateTime(at).replace('T', ' ') : '—';
const label = (tags: AudienceTag[], id: string) => tags.find((t) => t.id === id)?.labels.ko ?? '비활성 태그';
function range(days: number) {
  const now = Date.now();
  return { since: new Date(Math.floor((now + 32400000) / 86400000) * 86400000 - 32400000 - (days - 1) * 86400000).toISOString(), until: new Date(now).toISOString() };
}
export function AudienceDashboard() {
  const user = useAuthStore((s) => s.user); const caps = resolveAdminCapabilitySnapshot(user);
  const canManage = caps.superuser || caps.capabilities.includes('security.manage');
  const client = useQueryClient();
  const [days, setDays] = useState('7'); const [period, setPeriod] = useState(() => range(7));
  const [tab, setTab] = useState(canManage ? 'profiles' : 'creatives');
  const tags = useQuery({ queryKey: ['admin', 'audience', 'tags'], queryFn: () => apiClient.get<AudienceTag[]>(`${BASE}/tags`), staleTime: 60_000 });
  const overview = useQuery({ queryKey: ['admin', 'audience', 'overview'], queryFn: () => apiClient.get<AudienceOverview>(`${BASE}/overview`) });
  function refresh() { setPeriod(range(Number(days))); void client.invalidateQueries({ queryKey: ['admin', 'audience'] }); }
  return <div className="flex min-w-0 flex-col gap-6">
    <AdminPageHeader title="관심 고객·마케팅" description="선택한 취향, 행동의 근거와 홍보 소재별 전환을 함께 확인합니다."
      actions={<Button variant="outline" onClick={refresh}><RefreshCw data-icon="inline-start" />새로고침</Button>} />
    <div className="grid gap-3 sm:grid-cols-3">{overview.data ? <>
      <AdminStatCard label="활성 관심 프로필" value={overview.data.activeProfiles} format="people" icon={Users} description="취향 이용에 동의한 회원 · 90일 보관" />
      <AdminStatCard label="행동 분석 동의" value={overview.data.behaviorProfiles} format="people" icon={Heart} description="동의 이후의 행동으로만 보완" />
      <AdminStatCard label="마케팅 수신 동의" value={overview.data.marketingProfiles} format="people" icon={Mail} description="활성 프로필 중 현재 수신 동의 회원" />
    </> : overview.isError ? <Failure retry={() => void overview.refetch()} /> : <Skeleton className="h-28 w-full sm:col-span-3" />}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><ToggleGroup type="single" value={days} onValueChange={(v) => { if (v) { setDays(v); setPeriod(range(Number(v))); } }} aria-label="성과 조회 기간">
      <ToggleGroupItem value="7">최근 7일</ToggleGroupItem><ToggleGroupItem value="30">최근 30일</ToggleGroupItem><ToggleGroupItem value="90">최근 90일</ToggleGroupItem>
    </ToggleGroup><p className="text-xs text-muted-foreground">성과: {when(period.since)} ~ {when(period.until)} KST · 프로필: 현재 상태</p></div>
    {tags.isError ? <Failure retry={() => void tags.refetch()} /> : !tags.data ? <Skeleton className="h-60 w-full" /> :
      <Tabs value={tab} onValueChange={setTab} className="min-w-0"><TabsList className="h-auto flex-wrap justify-start">
        {canManage && <TabsTrigger value="profiles">개인별 관심 프로필</TabsTrigger>}<TabsTrigger value="creatives">홍보 소재 성과</TabsTrigger>
        {canManage && <TabsTrigger value="tags">관심 태그 관리</TabsTrigger>}<TabsTrigger value="ga4">GA4 관심사</TabsTrigger>
      </TabsList>
        {canManage && <TabsContent value="profiles"><Profiles tags={tags.data} overview={overview.data} /></TabsContent>}
        <TabsContent value="creatives"><Creatives period={period} /></TabsContent>
        {canManage && <TabsContent value="tags"><Tags tags={tags.data} /></TabsContent>}
        <TabsContent value="ga4"><GoogleInterests period={period} /></TabsContent>
      </Tabs>}
    <p className="text-xs leading-6 text-muted-foreground">직접 선택한 취향과 행동 추정은 서로 다른 근거입니다. 방문 기록은 분석에 동의한 일부 방문자만 포함하며, 기기 간 중복·기록 누락이 있을 수 있습니다. 이메일·문자 발송 전에는 최신 수신 동의를 다시 확인해야 합니다.</p>
  </div>;
}
function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="min-w-0"><CardHeader><CardTitle className="break-words"><h2>{title}</h2></CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex min-w-0 flex-col gap-4">{children}</CardContent></Card>;
}
function Failure({ retry }: { retry: () => void }) { return <Alert variant="destructive"><AlertTitle>불러오지 못했습니다</AlertTitle><AlertDescription><p>잠시 후 다시 시도해주세요.</p><Button variant="outline" onClick={retry}>다시 시도</Button></AlertDescription></Alert>; }
function NoData({ title = '아직 데이터가 없습니다', children }: { title?: string; children: ReactNode }) { return <Empty><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{children}</EmptyDescription></EmptyHeader></Empty>; }

function Profiles({ tags, overview }: { tags: AudienceTag[]; overview?: AudienceOverview }) {
  const [search, setSearch] = useState(''); const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [marketingOnly, setMarketingOnly] = useState(false); const [tagId, setTagId] = useState(''); const [selected, setSelected] = useState<string | null>(null);
  const profiles = useQuery({ queryKey: ['admin', 'audience', 'profiles', query, page, marketingOnly, tagId], queryFn: () => apiClient.get<{ rows: AudienceProfileSummary[]; total: number; pageSize: number }>(`${BASE}/profiles?${new URLSearchParams({ page: String(page), search: query, marketingOnly: String(marketingOnly), ...(tagId ? { tagId } : {}) })}`) });
  return <div className="flex min-w-0 flex-col gap-5">
    <Panel title="회원이 직접 선택한 관심" description="한 회원이 여러 관심에 포함됩니다. 숫자를 합쳐 전체 회원 수로 해석하지 않습니다.">
      {overview?.segments.length ? <div className="flex flex-wrap gap-2">{overview.segments.map((s) => <Button className="h-auto min-h-9 max-w-full whitespace-normal break-words" key={s.tagId} variant={s.tagId === tagId ? 'default' : 'outline'} size="sm" onClick={() => { setTagId(tagId === s.tagId ? '' : s.tagId); setPage(1); setSelected(null); }}>{label(tags, s.tagId)} · {s.members}명 / 수신동의 {s.marketingMembers}명</Button>)}</div> : <NoData>회원이 마이페이지에서 취향을 선택하면 관심군이 표시됩니다.</NoData>}
      {tagId && <Button variant="ghost" size="sm" onClick={() => { setTagId(''); setPage(1); }}>관심 필터 지우기</Button>}
    </Panel>
    <Panel title="개인별 관심 프로필" description="취향 이용에 동의한 활성 회원만 표시합니다. 이름을 눌러 직접 선택과 행동 근거를 확인하세요.">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setQuery(search); setPage(1); setSelected(null); }}><Field className="max-w-sm"><FieldLabel htmlFor="audience-search">회원 이름 또는 이메일</FieldLabel><Input id="audience-search" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} /></Field><Button type="submit">검색</Button></form>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={marketingOnly} onCheckedChange={(v) => { setMarketingOnly(v === true); setPage(1); setSelected(null); }} />현재 마케팅 수신 동의 회원만</label>
      {profiles.isError ? <Failure retry={() => void profiles.refetch()} /> : !profiles.data ? <Skeleton className="h-40 w-full" /> : <>
        <Table><TableHeader><TableRow><TableHead>회원</TableHead><TableHead>직접 선택한 취향</TableHead><TableHead>행동 분석</TableHead><TableHead>수신 동의</TableHead><TableHead>갱신 시각</TableHead></TableRow></TableHeader><TableBody>
          {profiles.data.rows.map((row) => <TableRow key={row.userId}><TableCell><Button variant="link" onClick={() => setSelected(row.userId)}>{row.name}</Button><p className="max-w-56 break-all text-xs text-muted-foreground">{row.email}</p></TableCell><TableCell className="max-w-80 whitespace-normal">{row.tagIds.map((id) => label(tags, id)).join(', ') || '선택 없음'}</TableCell><TableCell>{row.behaviorSince ? '동의' : '미동의'}</TableCell><TableCell><Badge variant={row.marketingConsent ? 'default' : 'secondary'}>{row.marketingConsent ? '동의' : '미동의'}</Badge></TableCell><TableCell>{when(row.updatedAt)}</TableCell></TableRow>)}
        </TableBody></Table>
        {!profiles.data.rows.length && <NoData title="조건에 맞는 프로필이 없습니다">취향 동의 전이거나 철회·만료된 회원은 포함하지 않습니다.</NoData>}
        <div className="flex items-center justify-between gap-2 text-sm"><span>{profiles.data.total}명 · {page}페이지</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1} onClick={() => { setPage(page - 1); setSelected(null); }}>이전</Button><Button variant="outline" disabled={page * 25 >= profiles.data.total} onClick={() => { setPage(page + 1); setSelected(null); }}>다음</Button></div></div>
      </>}
    </Panel>
    {selected && <ProfileDetail key={selected} id={selected} tags={tags} />}
  </div>;
}
function ProfileDetail({ id, tags }: { id: string; tags: AudienceTag[] }) {
  const profile = useQuery({ queryKey: ['admin', 'audience', 'profile', id], queryFn: () => apiClient.get<AudienceProfile>(`${BASE}/profiles/${id}`, { showErrorToast: false }), retry: 1, gcTime: 0 });
  if (profile.isError) return <Failure retry={() => void profile.refetch()} />;
  if (!profile.data) return <Skeleton className="h-60 w-full" />;
  const row = profile.data;
  const stages = { unknown: '아직 모름', viewed: '공연 조회', saved: '관심 공연 저장', checkout: '결제 시작 관측', purchased: '결제 확인' };
  return <Panel title={`${row.name}님의 관심 근거`} description={`최근 갱신 ${when(row.updatedAt)} · 보관 만료 ${when(row.expiresAt)}`}>
    <h3 className="font-medium">직접 선택한 취향</h3><div className="flex flex-wrap gap-2">{row.tagIds.length ? row.tagIds.map((id) => <Badge key={id} variant="secondary">{label(tags, id)}</Badge>) : <p className="text-sm text-muted-foreground">직접 선택한 항목이 없습니다.</p>}</div>
    <h3 className="font-medium">행동에서 추정한 관심</h3><p className="text-sm text-muted-foreground">분석 시작 {when(row.observedSince)} · 태그가 연결된 공연에서 확인된 구매 단계: {stages[row.purchaseStage]}</p>
    {row.inferred.length ? <Table><TableHeader><TableRow><TableHead>관심</TableHead><TableHead>근거 수준</TableHead><TableHead>관측 근거</TableHead><TableHead>최근 시각</TableHead></TableRow></TableHeader><TableBody>{row.inferred.map((r) => <TableRow key={r.tagId}><TableCell>{label(tags, r.tagId)}</TableCell><TableCell>{r.level === 'high' ? '강함' : r.level === 'medium' ? '보통' : '약함'}</TableCell><TableCell className="whitespace-normal">조회 {r.viewDays}일 · 현재 찜 {r.favorites}건 · 결제 시작 {r.checkouts}세션 · 유효 예매 {r.purchases}건</TableCell><TableCell>{when(r.lastAt)}</TableCell></TableRow>)}</TableBody></Table>
      : <NoData title="행동으로 판단할 근거가 없습니다">{row.behaviorSince ? '동의 이후의 기록이나 공연 관심 태그가 아직 부족합니다.' : '행동 분석에 동의하지 않아 직접 선택한 취향만 사용합니다.'}</NoData>}
    <p className="text-xs text-muted-foreground">근거 수준은 구매 확률이 아닙니다. 같은 날 반복 조회는 한 번으로 세고, 태그가 없는 공연은 분류하지 않습니다.</p>
  </Panel>;
}

function Creatives({ period }: { period: ReturnType<typeof range> }) {
  const report = useQuery({ queryKey: ['admin', 'audience', 'creatives', period], queryFn: () => apiClient.get<CreativeReport>(`${BASE}/creatives?${new URLSearchParams(period)}`) });
  return <div className="flex min-w-0 flex-col gap-5"><CreativeLinkBuilder />
    <Panel title="소재별 방문 → 전환" description="UTM source·medium·campaign·content 조합별 비교입니다. 기간 안에 시작한 관측 세션을 분모로 사용합니다.">
      {report.isError ? <Failure retry={() => void report.refetch()} /> : !report.data ? <Skeleton className="h-48 w-full" /> : !report.data.rows.length ? <NoData>소재별 홍보 링크로 방문이 쌓이면 여기에 표시됩니다. 수집 동의 전 방문은 포함되지 않습니다.</NoData> : <>
        <Table><TableHeader><TableRow>{['캠페인 / 소재', '유입 / 매체', '세션 / 방문자', '가입', '찜', '결제 시작', '결제 전환', '결제 건수'].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{report.data.rows.map((r) => <TableRow key={JSON.stringify([r.source, r.medium, r.campaign, r.content])}>
          <TableCell className="max-w-56 whitespace-normal break-words"><strong>{r.campaign || '캠페인 없음'}</strong><p>{r.content || '소재 구분 없음'}</p></TableCell><TableCell>{r.source}<br />{r.medium || '—'}</TableCell><TableCell>{r.sessions} / {r.visitors}</TableCell><TableCell>{r.signupSessions} · {r.signupRate}%</TableCell><TableCell>{r.favoriteSessions} · {r.favoriteRate}%</TableCell><TableCell>{r.checkoutSessions}</TableCell><TableCell>{r.paidSessions} · {r.paymentRate}%</TableCell><TableCell>{r.paidOrders}</TableCell>
        </TableRow>)}</TableBody></Table>
        {report.data.totalGroups > 100 && <p className="text-sm">전체 {report.data.totalGroups}개 중 방문이 많은 100개 조합입니다. 기간을 줄여 확인해주세요.</p>}
      </>}
      <p className="text-xs leading-6 text-muted-foreground">결제는 동일 회원·공연의 가장 최근 결제 시작에 한 번 연결하며 마지막 관측 후 30분까지 인정합니다. 이후 취소된 승인도 포함합니다. 찜은 이 기능 도입 이후 관측한 저장 동작입니다. 소재마다 유입 대상이 다를 수 있으므로 인과 효과나 A/B 실험 결과로 해석하지 않습니다. 광고 노출·비용을 수집하지 않아 클릭률과 ROAS는 계산하지 않습니다.</p>
    </Panel></div>;
}
function CreativeLinkBuilder() {
  const [values, setValues] = useState({ path: '/', source: 'instagram', medium: 'social', campaign: 'namtanfilm', content: '' });
  const [url, setUrl] = useState(''); const [error, setError] = useState('');
  const names = { path: '연결할 사이트 경로', source: '유입 채널 (source)', medium: '매체 (medium)', campaign: '캠페인 코드', content: '소재 코드 (content)' };
  return <Panel title="소재 구분 홍보 링크" description="같은 캠페인은 유지하고 소재 코드만 바꿔서 비교하세요. 예: artist-photo / photo-benefit. 개인 이름·전화번호·이메일은 넣지 않습니다.">
    <form onSubmit={(e) => { e.preventDefault(); const path = normalizeGa4Path(values.path); if (!path || path !== values.path || !values.content.trim()) { setError('공개 공연 경로와 소재 코드를 입력해주세요.'); setUrl(''); return; }
      const params = new URLSearchParams(); for (const key of ['source', 'medium', 'campaign', 'content'] as const) { const value = sanitizeAnalyticsCampaign(values[key]); if (!value) { setError('채널·캠페인·소재 코드는 문자, 숫자, 공백, 밑줄, 점, 하이픈으로 80자 이내 입력해주세요.'); setUrl(''); return; } params.set(`utm_${key}`, value); }
      setUrl(`${getFrontendOrigin()}${path}?${params}`); setError(''); }}>
      <FieldGroup className="grid gap-3 sm:grid-cols-2">{(Object.keys(names) as Array<keyof typeof names>).map((key) => <Field key={key}><FieldLabel htmlFor={`creative-${key}`}>{names[key]}</FieldLabel><Input id={`creative-${key}`} value={values[key]} maxLength={key === 'path' ? 160 : 80} onChange={(e) => { setValues({ ...values, [key]: e.target.value }); setUrl(''); }} required /></Field>)}</FieldGroup><Button className="mt-4" type="submit">홍보 링크 만들기</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {url && <Field><FieldLabel htmlFor="creative-result">완성된 홍보 링크</FieldLabel><Input id="creative-result" value={url} readOnly /><Button variant="outline" onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success('링크를 복사했습니다.')).catch(() => toast.error('링크를 직접 선택해 복사해주세요.'))}><Copy data-icon="inline-start" />복사</Button></Field>}
  </Panel>;
}

function Tags({ tags }: { tags: AudienceTag[] }) {
  const client = useQueryClient(); const [editing, setEditing] = useState<AudienceTag | null>(null);
  const performances = useQuery({ queryKey: ['admin', 'audience', 'performances'], queryFn: () => apiClient.get<AudiencePerformance[]>(`${BASE}/performances`) });
  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
    <Panel title="관심 태그" description="회원의 질문 선택지와 공연 분류에 함께 사용합니다. 비활성 태그는 신규 선택과 관심 추정에서 제외합니다.">
      <TagEditor key={editing?.id ?? 'new'} initial={editing} onDone={() => { setEditing(null); void client.invalidateQueries({ queryKey: ['admin', 'audience'] }); }} />
      {editing && <Button variant="ghost" onClick={() => setEditing(null)}>새 태그 작성</Button>}
      <Table><TableHeader><TableRow><TableHead>태그</TableHead><TableHead>종류</TableHead><TableHead>상태</TableHead><TableHead>편집</TableHead></TableRow></TableHeader><TableBody>{tags.map((tag) => <TableRow key={tag.id}><TableCell>{tag.labels.ko}</TableCell><TableCell>{kinds[tag.kind]}</TableCell><TableCell>{tag.active ? '사용' : '비활성'}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setEditing(tag)}>편집<span className="sr-only"> {tag.labels.ko}</span></Button></TableCell></TableRow>)}</TableBody></Table>
    </Panel>
    <Panel title="공연과 관심 연결" description="어떤 공연이 어떤 관심의 근거인지 지정합니다. 공개 여부는 기존 공연 관리에서 변경합니다.">
      {performances.isError ? <Failure retry={() => void performances.refetch()} /> : !performances.data ? <Skeleton className="h-48 w-full" /> : <PerformanceTags rows={performances.data} tags={tags.filter((t) => t.active)} />}
    </Panel>
  </div>;
}
function TagEditor({ initial, onDone }: { initial: AudienceTag | null; onDone: () => void }) {
  const [form, setForm] = useState<AudienceTagInput>(initial ?? { slug: '', kind: 'artist', labels: { ko: '', en: '' }, active: true }); const [error, setError] = useState('');
  const save = useMutation({ mutationFn: () => initial ? apiClient.put(`${BASE}/tags/${initial.id}`, form) : apiClient.post(`${BASE}/tags`, form), onSuccess: () => { toast.success('태그를 저장했습니다.'); if (!initial) setForm({ slug: '', kind: 'artist', labels: { ko: '', en: '' }, active: true }); onDone(); }, onError: () => setError('저장하지 못했습니다. 태그 코드 중복 여부를 확인해주세요.') });
  return <form onSubmit={(e) => { e.preventDefault(); const parsed = audienceTagInputSchema.safeParse(form); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.'); return; } setError(''); save.mutate(); }}>
    <FieldGroup><FieldSet><FieldLegend>태그 종류</FieldLegend><ToggleGroup type="single" value={form.kind} onValueChange={(kind) => { if (kind) setForm({ ...form, kind: kind as AudienceTagInput['kind'] }); }} aria-label="태그 종류">{Object.entries(kinds).map(([key, value]) => <ToggleGroupItem key={key} value={key}>{value}</ToggleGroupItem>)}</ToggleGroup></FieldSet>
      <Field><FieldLabel htmlFor="tag-slug">태그 코드</FieldLabel><Input id="tag-slug" value={form.slug} required maxLength={60} placeholder="artist-name" onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
      {(['ko', 'en', 'th', 'zh-CN'] as const).map((locale) => <Field key={locale}><FieldLabel htmlFor={`tag-${locale}`}>{locale === 'ko' ? '한국어 이름' : locale === 'en' ? '영어 이름' : locale === 'th' ? '태국어 이름 (선택)' : '중국어 이름 (선택)'}</FieldLabel><Input id={`tag-${locale}`} value={form.labels[locale] ?? ''} required={locale === 'ko' || locale === 'en'} maxLength={80} onChange={(e) => { const labels = { ...form.labels, [locale]: e.target.value }; if (!e.target.value && locale !== 'ko' && locale !== 'en') delete labels[locale]; setForm({ ...form, labels }); }} /></Field>)}
      <Field orientation="horizontal"><Checkbox id="tag-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} /><FieldLabel htmlFor="tag-active">사용 중</FieldLabel></Field>
    </FieldGroup>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<Button className="mt-4" disabled={save.isPending} type="submit">{initial ? '태그 수정 저장' : '태그 추가'}</Button>
  </form>;
}
function PerformanceTags({ rows, tags }: { rows: AudiencePerformance[]; tags: AudienceTag[] }) {
  const [selected, setSelected] = useState(rows[0]?.id ?? ''); const row = rows.find((r) => r.id === selected);
  return <><Field><FieldLabel htmlFor="audience-performance">공연</FieldLabel><select id="audience-performance" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={selected} onChange={(e) => setSelected(e.target.value)}>{rows.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.publishState}</option>)}</select></Field>
    {row ? <PerformanceTagEditor key={`${row.id}:${row.tagIds.join(',')}`} row={row} tags={tags} /> : <NoData>등록한 공연이 없습니다.</NoData>}</>;
}
function PerformanceTagEditor({ row, tags }: { row: AudiencePerformance; tags: AudienceTag[] }) {
  const [ids, setIds] = useState(row.tagIds.filter((id) => tags.some((t) => t.id === id))); const client = useQueryClient();
  const save = useMutation({ mutationFn: () => apiClient.put(`${BASE}/performances/${row.id}/tags`, { tagIds: ids }), onSuccess: () => { toast.success('공연 관심 태그를 저장했습니다.'); void client.invalidateQueries({ queryKey: ['admin', 'audience'] }); } });
  return <><ToggleGroup type="multiple" variant="outline" spacing={2} value={ids} onValueChange={(v) => { if (v.length <= 15) setIds(v); }} aria-label="공연 관심 태그" className="max-w-full flex-wrap justify-start">{tags.map((t) => <ToggleGroupItem className="h-auto min-h-9 max-w-full whitespace-normal break-words" key={t.id} value={t.id}>{t.labels.ko}</ToggleGroupItem>)}</ToggleGroup>
    <Button onClick={() => save.mutate()} disabled={save.isPending}>공연 태그 저장</Button>{save.isError && <p role="alert" className="text-sm text-destructive">저장하지 못했습니다. 다시 시도해주세요.</p>}</>;
}

function GoogleInterests({ period }: { period: ReturnType<typeof range> }) {
  const report = useQuery({ queryKey: ['admin', 'audience', 'ga4', period], queryFn: () => apiClient.get<Ga4InterestReport>(`${BASE}/ga4?${new URLSearchParams(period)}`, { showErrorToast: false }), staleTime: 30 * 60_000, retry: 1 });
  const config = useQuery({ queryKey: ['audience', 'ga4-config'], queryFn: () => apiClient.get<Ga4Config>('/api/v1/analytics/audience/ga4-config'), staleTime: 60_000 });
  const states = { not_configured: 'GA4 속성 연결을 준비하고 있습니다.', empty: '현재 기간에 Google이 제공한 관심사 행이 없습니다. 수집 지연·동의 표본·임계값 등의 영향일 수 있습니다.', permission_denied: 'GA4 속성 조회 권한을 확인해주세요.', quota_exceeded: 'Google API 조회 한도에 도달했습니다. 잠시 후 다시 확인해주세요.', unavailable: '현재 Google 보고서를 불러올 수 없습니다.', refreshing: '다른 요청에서 보고서를 갱신하고 있습니다. 잠시 후 새로고침해주세요.', ready: '' };
  return <Panel title="Google이 제공한 집계 관심사" description="동의한 Google 이용자 일부의 관심사 분포입니다. Grabit 회원별 취향과 연결하지 않습니다.">
    <div className="flex flex-wrap gap-2"><Badge variant={config.data?.enabled ? 'default' : 'secondary'}>{config.isError ? 'Google 수집 설정 확인 불가' : !config.data ? 'Google 수집 설정 확인 중' : config.data.enabled ? '동의 후 Google 수집 가능' : 'Google 태그 수집 꺼짐'}</Badge><Badge variant="outline">최대 30분 캐시</Badge></div>
    {report.isError ? <Failure retry={() => void report.refetch()} /> : !report.data ? <Skeleton className="h-48 w-full" /> : <>
      <p className="text-sm text-muted-foreground">{report.data.startDate} ~ {report.data.endDate} · 속성 시간대 {report.data.timeZone ?? '확인 전'} · 최근 조회 {when(report.data.fetchedAt)}{report.data.cached ? ' (캐시)' : ''}</p>
      {report.data.subjectToThresholding && <Alert><AlertTitle>개인정보 보호 임계값 적용 대상</AlertTitle><AlertDescription>일부 범주가 표시되지 않을 수 있습니다. 이 표시는 실제 누락 여부를 확정하지 않습니다.</AlertDescription></Alert>}
      {(report.data.sampled || report.data.dataLossFromOtherRow) && <Alert><AlertTitle>제한된 보고서</AlertTitle><AlertDescription>표본 추출 또는 기타 행 집계의 영향을 받습니다.</AlertDescription></Alert>}
      {report.data.state !== 'ready' ? <NoData title="관심사 보고서 상태">{states[report.data.state]}</NoData> : <Table><TableHeader><TableRow><TableHead>관심 범주</TableHead><TableHead>활성 사용자</TableHead></TableRow></TableHeader><TableBody>{report.data.rows.map((r) => <TableRow key={r.interest}><TableCell className="whitespace-normal">{r.interest}</TableCell><TableCell>{r.activeUsers.toLocaleString()}</TableCell></TableRow>)}</TableBody></Table>}
      <p className="text-xs text-muted-foreground">최대 25개 범주를 표시합니다. 한 사람이 여러 관심사에 포함될 수 있어 합계·점유율을 계산하지 않습니다. 빈 결과는 관심사가 없다는 뜻이 아닙니다.</p>
      {report.data.propertyId && <Button variant="outline" asChild><Link target="_blank" rel="noopener noreferrer" href={`https://analytics.google.com/analytics/web/#/p${report.data.propertyId}`}>Google Analytics에서 확인</Link></Button>}
    </>}
  </Panel>;
}
