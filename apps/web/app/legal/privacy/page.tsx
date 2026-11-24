import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { legalDocuments } from '@/content/legal/documents';
import { resolveConsentDocumentLanguage } from '@grabit/shared';
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
  const labels = getVisibleCopy(locale).privacyNotices;
  const markdown = legalDocuments.privacy[resolveConsentDocumentLanguage(locale)];

  return (
    <>
      <aside id="virtual-account" className="mb-6 scroll-mt-20 space-y-2 rounded-lg border p-4 text-sm">
        <h2 className="font-semibold">{labels.virtualTitle}</h2>
        <p>{labels.virtualIssue}</p>
        <p>{labels.virtualRefund}</p>
      </aside>
      <aside className="mb-6 rounded-lg border p-4 text-sm"><Link className="underline" href={getLocalizedPathname('/legal/analytics', locale as SupportedLocale)}>{labels.analytics}</Link></aside>
      <aside className="mb-6 space-y-2 rounded-lg border p-4 text-sm">
        <p>{labels.options}</p>
        <Link className="underline" href={`${getLocalizedPathname('/legal/analytics', locale as SupportedLocale)}#google`}>{labels.google}</Link>
        <p><Link className="underline" href={getLocalizedPathname('/mypage/interests', locale as SupportedLocale)}>{labels.preferences}</Link></p>
      </aside>
      <TermsMarkdown showH1>{markdown}</TermsMarkdown>
    </>
  );
}
