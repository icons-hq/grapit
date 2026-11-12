'use client';
import { useSyncExternalStore } from 'react';
import { useLocale } from 'next-intl';
import { aggregateAnalyticsDisabled, setAggregateAnalyticsDisabled, subscribeAggregateChoice } from '@/lib/analytics-counts-client';
import { Button } from '@/components/ui/button';

export function AggregateAnalyticsSettings({ active }: { active: boolean }) {
  const ko = useLocale() === 'ko';
  const disabled = useSyncExternalStore(subscribeAggregateChoice, aggregateAnalyticsDisabled, () => true);
  return <section className="flex flex-col gap-4 rounded-xl border p-5">
    <h2 className="text-xl font-semibold">{ko ? '식별자 없는 이용 횟수 집계' : 'Usage counts without visitor identifiers'}</h2>
    <p className="text-sm leading-7">{ko ? '2026년 11월 12일부터 서비스 개선을 위해 공개 화면 종류와 페이지 표시·가입 시작·예매 진입·좌석 선택·결제 시작·링크 클릭·75% 스크롤·30초 이상 표시 횟수를 시간별로 합산합니다. 방문자·세션·회원 ID, 전체 URL, 입력 내용, 유입 정보나 기기 정보를 이 집계에 저장하지 않습니다. 개별 이벤트 이력을 남기지 않으며, 사람 수·개인별 이동 경로를 계산하거나 광고 매체에 전달하지 않습니다. 합계는 최대 365일 보관합니다.' : 'From November 12, 2026, we total public screen categories and page displays, signup/booking/checkout starts, seat-selection actions, link clicks, 75% scrolls and 30-second displays by hour to improve the service. These counters store no visitor, session or member IDs, full URLs, form contents, referrals or device information. We retain no individual event history, do not identify people or journeys, and do not send these counts to advertising platforms. Totals are retained for up to 365 days.'}</p>
    <p className="text-sm leading-7">{ko ? '브라우저의 추적 거부 신호와 아래 설정을 따릅니다. 집계를 꺼도 가입·로그인·예매를 이용할 수 있습니다. 저장하는 설정은 허용/거부 값뿐이며, 이 브라우저에서 변경하거나 사이트 데이터를 삭제할 때까지 유지됩니다. 보안·서비스 제공을 위한 기존 접속 로그는 개인정보처리방침에 따라 별도로 처리됩니다.' : 'We respect browser privacy signals and the setting below. Turning counts off does not affect signup, sign-in or booking. Only an on/off preference is stored until you change it or clear site data. Existing security and service access logs are handled separately under the Privacy Policy.'}</p>
    <p role="status" className="text-sm">{!active ? (ko ? '현재 서버의 횟수 집계가 꺼져 있습니다.' : 'Server-side usage counting is currently off.') : disabled ? (ko ? '이 브라우저의 횟수 집계가 꺼져 있습니다.' : 'Usage counting is off on this browser.') : (ko ? '이 브라우저의 횟수 집계가 켜져 있습니다.' : 'Usage counting is on on this browser.')}</p>
    <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => setAggregateAnalyticsDisabled(true)}>{ko ? '횟수 집계 끄기' : 'Turn counts off'}</Button><Button variant="outline" disabled={!active} onClick={() => setAggregateAnalyticsDisabled(false)}>{ko ? '횟수 집계 켜기' : 'Turn counts on'}</Button></div>
  </section>;
}
