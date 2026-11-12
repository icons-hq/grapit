'use client';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { setAnalyticsChoice } from '@/lib/analytics-client';
import { analyticsCopy } from './analytics-copy';

export function AnalyticsConsentControls({ disabled }: { disabled: boolean }) {
  const locale = useLocale(); const ko = locale === 'ko'; const copy = analyticsCopy(locale);
  const [collection, setCollection] = useState(false); const [overseas, setOverseas] = useState(false);
  return <section data-analytics-consent className="space-y-4 rounded-lg border p-4">
    <p className="text-sm">{ko ? '각 항목을 확인하고 따로 선택해주세요. 두 항목 모두 동의한 시점부터 개인별 분석과 화면 재생 기록을 시작합니다. 거부해도 가입·예매에 영향이 없습니다.' : 'Choose each item separately. Individual analytics and masked session recordings start only after both choices are accepted. Declining does not affect signup or booking.'}</p>
    <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={collection} onCheckedChange={(value) => setCollection(value === true)} disabled={disabled} className="mt-1" /><span>{ko ? '[선택] 방문·회원 연결·클릭/터치 좌표·스크롤·마스킹된 화면 재생을 위한 개인정보 수집·이용에 동의합니다. 행동 기록 90일, 화면 재생 14일 보관에 동의합니다.' : '[Optional] I agree to collection and use for account-linked visits, click/touch coordinates, scrolling and masked session replay. Activity is retained for 90 days and replay for 14 days.'}</span></label>
    <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={overseas} onCheckedChange={(value) => setOverseas(value === true)} disabled={disabled} className="mt-1" /><span>{ko ? '[선택] 위에 안내한 Google Cloud의 국가·수신자·목적·보관기간·전송 방법을 확인하고, 선택 분석의 국외 이전에 별도로 동의합니다.' : '[Optional] I separately agree to international transfers for optional analytics, after reviewing the Google Cloud countries, recipients, purposes, retention and transfer methods above.'}</span></label>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={disabled || !collection || !overseas} onClick={() => setAnalyticsChoice('accepted', { collectionConsent: collection, overseasConsent: overseas })}>{copy.accept}</Button><Button variant="outline" onClick={() => setAnalyticsChoice('declined')}>{copy.decline}</Button></div>
  </section>;
}
