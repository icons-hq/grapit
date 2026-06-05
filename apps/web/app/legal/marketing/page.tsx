import { getLocale } from 'next-intl/server';
import marketingMd from '@/content/legal/marketing-consent.md?raw';
import marketingEnMd from '@/content/legal/marketing-consent.en.md?raw';
import { LegalFallbackLabel } from '@/components/legal/legal-fallback-label';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getLegalRobots } from '../robots';

export const dynamic = 'force-static';

// Phase 16 review HIGH-4: prod 만 index. preview/staging 은 noindex

export async function generateMetadata() {
  const locale = await getLocale();
  const copy = getVisibleCopy(locale).metadata.legal;

  return {
    title: copy.marketingTitle,
    description: copy.marketingDescription,
    alternates: {
      canonical: 'https://heygrabit.com/legal/marketing',
    },
    robots: getLegalRobots(),
  };
}

export default async function MarketingPage() {
  const locale = await getLocale();
  const fallbackLocale = locale === 'th' || locale === 'zh-CN' ? locale : null;
  const markdown = locale === 'en' || fallbackLocale ? marketingEnMd : marketingMd;

  return (
    <>
      {fallbackLocale ? <LegalFallbackLabel locale={fallbackLocale} /> : null}
      <TermsMarkdown showH1>{markdown}</TermsMarkdown>
    </>
  );
}
