'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { normalizeGa4Path, isAdultForGoogleInterests, type Ga4Config } from '@grabit/shared';
import { getGa4Choice, setGa4Choice, stopGa4, subscribeGa4Choice, updateGa4 } from '@/lib/ga4-client';
import { analyticsPrivacySignal, getAnalyticsChoice, subscribeAnalyticsChoice } from '@/lib/analytics-client';
import { apiClient } from '@/lib/api-client';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field';
import { useAuthStore } from '@/stores/use-auth-store';

export function useGa4Config() {
  return useQuery({ queryKey: ['audience', 'ga4-config'], queryFn: () => apiClient.get<Ga4Config>('/api/v1/analytics/audience/ga4-config', { showErrorToast: false }), staleTime: 30_000, refetchInterval: (query) => query.state.data?.enabled ? 30_000 : false, refetchIntervalInBackground: false, retry: false });
}
export function Ga4Provider() {
  const config = useGa4Config(); const pathname = usePathname(); const search = useSearchParams().toString();
  const choice = useSyncExternalStore(subscribeGa4Choice, getGa4Choice, () => null);
  const ownChoice = useSyncExternalStore(subscribeAnalyticsChoice, getAnalyticsChoice, () => null);
  const authReady = useAuthStore((s) => s.isInitialized);
  const role = useAuthStore((s) => s.user?.role);
  const birthday = useAuthStore((s) => s.user?.birthDate);
  const accountEligible = !role || (role === 'user' && isAdultForGoogleInterests(birthday));
  const locale = resolveVisibleCopyLocale(useLocale()); const ko = locale === 'ko';
  useEffect(() => {
    const sync = () => updateGa4(config.isError || !authReady || !accountEligible ? undefined : config.data, pathname);
    sync();
    // Also enforce expiry/privacy choices on a long-lived page without traffic.
    const timer = choice === 'accepted' ? window.setInterval(sync, 30_000) : null;
    window.addEventListener('focus', sync);
    return () => { if (timer !== null) window.clearInterval(timer); window.removeEventListener('focus', sync); stopGa4(); };
  }, [config.data, config.isError, pathname, search, choice, authReady, accountEligible]);
  if (!authReady || !accountEligible || config.isError || !config.data?.enabled || choice !== null || ownChoice === null || analyticsPrivacySignal() || !normalizeGa4Path(pathname)) return null;
  return <aside aria-label={ko ? 'Google 관심사 분석 선택' : 'Optional Google interest analytics'} data-analytics-private data-analytics-consent className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-2xl flex-col gap-3 rounded-xl border bg-background p-5 shadow-lg md:bottom-4">
    <p className="font-semibold">{ko ? 'Google 관심사 분석 (선택)' : 'Google interest analytics (optional)'}</p>
    <p className="text-sm leading-6">{ko ? '쿠키와 공개 페이지 이용 정보를 Google에 전송하여 일부 이용자의 집계 관심사를 확인합니다. Google 계정의 광고 개인 최적화 정보가 결합될 수 있습니다. 거부해도 예매할 수 있습니다.' : 'Send cookies and public-page activity to Google for aggregate interest reports. Google may associate this with consenting signed-in users who enabled ads personalisation. Declining does not affect booking.'}</p>
    <Link className="text-sm underline" href={`${getLocalizedPathname('/legal/analytics', locale)}#google`}>{ko ? '처리 국가·항목·보관기간 상세 보기' : 'Countries, data and retention details'}</Link>
    <Ga4ChoiceControls enabled />
  </aside>;
}
export function Ga4ChoiceControls({ enabled }: { enabled: boolean }) {
  const locale = useLocale(); const ko = locale === 'ko';
  const user = useAuthStore((s) => s.user);
  const eligible = enabled && (!user || (user.role === 'user' && isAdultForGoogleInterests(user.birthDate)));
  const choice = useSyncExternalStore(subscribeGa4Choice, getGa4Choice, () => null);
  const [collection, setCollection] = useState(false); const [transfer, setTransfer] = useState(false); const [adult, setAdult] = useState(false); const [error, setError] = useState(false);
  return <div className="flex flex-col gap-3" data-analytics-private>
    {choice !== 'accepted' && <FieldSet disabled={!eligible || analyticsPrivacySignal()}><FieldLegend className="sr-only">{ko ? 'Google 분석 선택 동의' : 'Optional Google analytics choices'}</FieldLegend>
      <Field orientation="horizontal"><Checkbox id={`google-collection-${enabled}`} checked={collection} onCheckedChange={(v) => setCollection(v === true)} /><FieldLabel htmlFor={`google-collection-${enabled}`}>{ko ? 'Google 관심사 분석 수집·이용 동의 (선택)' : 'Allow collection/use for Google interest analytics (optional)'}</FieldLabel></Field>
      <Field orientation="horizontal"><Checkbox id={`google-transfer-${enabled}`} checked={transfer} onCheckedChange={(v) => setTransfer(v === true)} /><FieldLabel htmlFor={`google-transfer-${enabled}`}>{ko ? 'Google 국외 이전 동의 (선택)' : 'Allow international transfer to Google (optional)'}</FieldLabel></Field>
      <Field orientation="horizontal"><Checkbox id={`google-adult-${enabled}`} checked={adult} onCheckedChange={(v) => setAdult(v === true)} /><FieldLabel htmlFor={`google-adult-${enabled}`}>{ko ? '만 18세 이상입니다.' : 'I am at least 18 years old.'}</FieldLabel></Field>
    </FieldSet>}
    <div className="flex flex-wrap gap-2">{choice !== 'accepted' && <Button disabled={!eligible || !collection || !transfer || !adult || analyticsPrivacySignal()} onClick={() => setError(!setGa4Choice(true))}>{ko ? '선택 항목 동의' : 'Allow selected analytics'}</Button>}
      <Button variant="outline" onClick={() => { setError(!setGa4Choice(false)); setCollection(false); setTransfer(false); setAdult(false); }}>{choice === 'accepted' ? ko ? '철회·수집 중단' : 'Withdraw and stop' : ko ? '거부' : 'Decline'}</Button></div>
    <p role="status" className="text-xs text-muted-foreground">{choice === 'accepted' ? ko ? 'Google 관심사 분석에 동의한 상태입니다.' : 'Google interest analytics is allowed.' : choice === 'declined' ? ko ? 'Google 관심사 분석을 거부한 상태입니다.' : 'Google interest analytics is declined.' : ''}</p>
    {error && <p role="alert" className="text-sm text-destructive">{ko ? '선택을 저장하지 못했습니다. 수집은 중지했습니다.' : 'Could not save your choice. Collection has stopped.'}</p>}
  </div>;
}
export function Ga4ProcessingDetails() {
  const config = useGa4Config(); const locale = useLocale(); const ko = locale === 'ko';
  const countries = (config.data?.transferCountries ?? []).map((c) => new Intl.DisplayNames([ko ? 'ko' : 'en'], { type: 'region' }).of(c)).join(', ');
  return <section id="google" className="flex scroll-mt-20 flex-col gap-4 border-t pt-6" data-analytics-private data-analytics-consent>
    <h2 className="text-xl font-semibold">{ko ? 'Google 관심사 분석 · 별도 선택기능' : 'Google interest analytics · separate optional feature'}</h2>
    <p className="text-sm leading-7">{ko ? '수신자: Google LLC (1600 Amphitheatre Parkway, Mountain View, CA 94043, USA). 목적: 공개 페이지의 방문과 캠페인 성과, 집계 관심사 분석. 동의한 경우에만 Google 쿠키·브라우저 식별자, 기기·브라우저 정보, 공개 페이지 경로와 정제한 유입 정보를 HTTPS로 전송합니다. Google은 IP로 대략적인 지역을 산출하며, 광고 개인 최적화에 동의한 Google 로그인 정보와 결합해 집계 관심사를 제공할 수 있습니다. Grabit 회원 ID·연락처·취향 답변·결제 내역은 보내지 않습니다.' : 'Recipient: Google LLC (1600 Amphitheatre Parkway, Mountain View, CA 94043, USA). Purpose: public-page visits, campaign performance and aggregate interest analysis. Only after consent, Google cookies/browser identifiers, device/browser information, public paths and sanitised acquisition information are sent over HTTPS. Google derives approximate location from IP and may associate activity with consenting signed-in users who enabled ads personalisation. Grabit member IDs, contact details, preference answers and payment records are not sent.'}</p>
    <p className="text-sm leading-7">{ko ? '처리될 수 있는 국가·지역: ' : 'Possible processing countries/regions: '}{countries || (ko ? '확정 전 · 전송 비활성화' : 'Not confirmed · transmission disabled')}. {ko ? 'Google이 공개한 데이터센터와 Google Analytics 재처리자의 서비스 운영·지원 소재 범위를 안내합니다. 실제 저장·지원 경로는 달라질 수 있으며 모든 방문 자료가 모든 국가에 복제된다는 뜻은 아닙니다. 두 항목에 동의한 뒤 공개 페이지를 방문할 때 HTTPS로 전송됩니다.' : 'This covers Google’s published data-centre locations and Google Analytics subprocessors’ service-operation/support locations. Actual storage/support routes may vary; this does not mean every visit is copied to every country. Data is sent over HTTPS on public-page visits after both consents.'}</p>
    <p className="text-sm leading-7">{ko ? '브라우저 선택 기록은 최대 90일, Google 분석 쿠키는 60일이며 재방문으로 자동 연장하지 않습니다. GA 사용자·이벤트 자료와 Google 신호 자료는 2개월 설정을 적용하며 만료 삭제는 월별로 이루어집니다. 표준 집계 보고서에는 이 보관 설정이 적용되지 않습니다. Google 시스템의 최종 삭제는 삭제 지시 후 처리 약관상 최대 180일이 걸릴 수 있습니다.' : 'Your choice is stored for up to 90 days; Google analytics cookies expire after 60 days without automatic renewal. GA user/event and Google signals data use a 2-month retention setting with monthly expiry deletion. This setting does not apply to standard aggregated reports. Final deletion from Google systems may take up to 180 days after deletion instructions under its processing terms.'}</p>
    <p className="text-sm leading-7">{ko ? '두 항목 모두 선택사항이며 거부해도 가입·예매에 제한이 없습니다. 철회하면 이후 전송을 중단하고 이 브라우저의 Google 분석 쿠키를 지웁니다. 이미 만들어진 Google 집계가 즉시 삭제된다는 뜻은 아닙니다. 선택 변경·추가 권리 요청: privacy@heygrabit.com.' : 'Both consents are optional; declining does not affect signup or booking. Withdrawal stops future transmission and clears Google analytics cookies in this browser. It does not immediately erase Google’s existing aggregate reports. Further requests: privacy@heygrabit.com.'}</p>
    <p className="text-xs text-muted-foreground"><a className="underline" href="https://business.safety.google/adsprocessorterms/">Google {ko ? '처리 약관·연락처' : 'processing terms/contact'}</a> · <a className="underline" href="https://business.safety.google/adssubprocessors/">{ko ? '재처리자 법인·소재지' : 'Subprocessor entities/locations'}</a> · <a className="underline" href="https://datacenters.google/locations/">{ko ? '데이터센터 위치' : 'Data-centre locations'}</a> · <a className="underline" href="https://support.google.com/analytics/answer/7667196">{ko ? '보관 설정 안내' : 'Retention details'}</a></p>
    {!config.data?.enabled && <p className="text-sm text-muted-foreground">{ko ? '현재 Google 관심사 수집이 비활성화되어 있습니다.' : 'Google interest collection is currently disabled.'}</p>}
    <Ga4ChoiceControls enabled={!config.isError && config.data?.enabled === true} />
  </section>;
}
