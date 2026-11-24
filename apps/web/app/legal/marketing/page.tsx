import { getLocale } from 'next-intl/server';
import { legalDocuments } from '@/content/legal/documents';
import { resolveConsentDocumentLanguage } from '@grabit/shared';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getLegalRobots } from '../robots';

// Locale comes from the request header written by the locale proxy.
// force-static discards that header and serves Korean for every language.
export const dynamic = 'force-dynamic';

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
  const markdown = legalDocuments.marketing[resolveConsentDocumentLanguage(locale)];

  return <TermsMarkdown showH1>{markdown}</TermsMarkdown>;
}
