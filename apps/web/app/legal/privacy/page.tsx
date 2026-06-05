import { getLocale } from 'next-intl/server';
import privacyMd from '@/content/legal/privacy-policy.md?raw';
import privacyEnMd from '@/content/legal/privacy-policy.en.md?raw';
import { LegalFallbackLabel } from '@/components/legal/legal-fallback-label';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getLegalRobots } from '../robots';

export const dynamic = 'force-static';

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
      {fallbackLocale ? <LegalFallbackLabel locale={fallbackLocale} /> : null}
      <TermsMarkdown showH1>{markdown}</TermsMarkdown>
    </>
  );
}
