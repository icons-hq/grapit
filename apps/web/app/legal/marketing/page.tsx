import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import marketingMd from '@/content/legal/marketing-consent.md?raw';
import marketingEnMd from '@/content/legal/marketing-consent.en.md?raw';
import { LegalFallbackLabel } from '@/components/legal/legal-fallback-label';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getLegalRobots } from '../robots';

export const dynamic = 'force-static';

// Phase 16 review HIGH-4: prod 만 index. preview/staging 은 noindex

export const metadata: Metadata = {
  title: '마케팅 정보 수신 동의 — Grabit',
  description:
    'Grabit이 발송하는 마케팅 정보의 수신 항목, 전송 수단, 동의 거부 권리를 안내합니다.',
  alternates: {
    canonical: 'https://heygrabit.com/legal/marketing',
  },
  robots: getLegalRobots(),
};

export default async function MarketingPage() {
  const locale = await getLocale();
  const fallbackLocale = locale === 'th' || locale === 'zh-CN' || locale === 'zh-TW' ? locale : null;
  const markdown = locale === 'en' || fallbackLocale ? marketingEnMd : marketingMd;

  return (
    <>
      {fallbackLocale ? <LegalFallbackLabel locale={fallbackLocale} /> : null}
      <TermsMarkdown showH1>{markdown}</TermsMarkdown>
    </>
  );
}
