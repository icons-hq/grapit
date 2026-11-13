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
