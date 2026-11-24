import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import privacyMd from '@/content/legal/privacy-policy.md?raw';
import privacyEnMd from '@/content/legal/privacy-policy.en.md?raw';
import { LegalFallbackLabel } from '@/components/legal/legal-fallback-label';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getLegalRobots } from '../robots';
import { getLocalizedPathname } from '@/lib/i18n/locale-path';
import type { SupportedLocale } from '@grabit/shared';

// Locale comes from the request header written by the locale proxy.
// force-static discards that header and serves Korean for every language.
export const dynamic = 'force-dynamic';

// Phase 16 review HIGH-4: prod 만 index. preview/staging 은 noindex (placeholder 누출 차단)

export async function generateMetadata() {
  const locale = await getLocale();
  const copy = getVisibleCopy(locale).metadata.legal;

  return {
    title: copy.privacyTitle,
    description: copy.privacyDescription,
    alternates: {
      canonical: 'https://heygrabit.com/legal/privacy',
    },
    robots: getLegalRobots(),
  };
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  const fallbackLocale = locale === 'th' || locale === 'zh-CN' ? locale : null;
  const markdown = locale === 'en' || fallbackLocale ? privacyEnMd : privacyMd;

  return (
    <>
      <aside id="virtual-account" className="mb-6 scroll-mt-20 space-y-2 rounded-lg border p-4 text-sm">
        <h2 className="font-semibold">{locale === 'ko' ? '무통장입금·환불계좌 처리 안내' : 'Virtual account payments and refund bank details'}</h2>
        <p>{locale === 'ko'
          ? '무통장입금을 선택하면 그랩잇은 토스페이먼츠에서 입금 은행·가상계좌번호·입금기한·처리 상태를 받아 예매 내역에 표시하고, 입금 확인 후 티켓을 발급합니다.'
          : 'When you choose a virtual account, Grabit receives the deposit bank, virtual account number, deadline and payment status from Toss Payments. Grabit shows these details in your booking and issues your ticket when the deposit is confirmed.'}</p>
        <p>{locale === 'ko'
          ? '결제창에 입력한 환불 은행·계좌번호·예금주명은 그랩잇이 암호화해 보관하고, 취소 시 환불 처리를 위해 토스페이먼츠에 전달합니다. 환불계좌 제공을 원하지 않으면 해당 공연에서 제공하는 다른 결제수단을 선택할 수 있습니다. 결제 기록의 보유 기간은 아래 제3조에서 확인할 수 있습니다.'
          : 'Grabit stores the refund bank, account number and account holder name you enter at checkout in encrypted form and sends these details to Toss Payments to process a refund. If you prefer not to provide a refund account, you can choose another payment method offered for the event. Article 3 below describes how long payment records are retained.'}</p>
      </aside>
      <aside className="mb-6 rounded-lg border p-4 text-sm"><Link className="underline" href={getLocalizedPathname('/legal/analytics', locale as SupportedLocale)}>{locale === 'ko' ? '2026-11-12 개인별 방문·화면 재생 선택기능 안내·설정' : '2026-11-12 optional individual analytics and replay notice'}</Link></aside>
      <aside className="mb-6 space-y-2 rounded-lg border p-4 text-sm">
        <p>{locale === 'ko' ? '2026-11-13 별도 선택기능 안내: 관심 취향 설정과 Google 관심사 분석은 각각 별도 동의한 경우에만 이용합니다. Google 관심분야 보고에는 자사 분석 쿠키와 Google 광고 쿠키·식별자가 함께 사용될 수 있습니다.' : 'Optional features notice, November 13, 2026: preference profiles and Google interest analytics each require separate consent. Google interest reports may use first-party analytics cookies together with Google advertising cookies/identifiers.'}</p>
        <Link className="underline" href={`${getLocalizedPathname('/legal/analytics', locale as SupportedLocale)}#google`}>{locale === 'ko' ? 'Google 처리·국외 이전·쿠키·거부 및 철회 방법' : 'Google processing, transfers, cookies and opt-out/withdrawal options'}</Link>
        <p><Link className="underline" href={getLocalizedPathname('/mypage/interests', locale as SupportedLocale)}>{locale === 'ko' ? '관심 취향 안내·설정·철회' : 'Preference notice, settings and withdrawal'}</Link></p>
      </aside>
      {fallbackLocale ? <LegalFallbackLabel locale={fallbackLocale} /> : null}
      <TermsMarkdown showH1>{markdown}</TermsMarkdown>
    </>
  );
}
