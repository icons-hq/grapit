import { analyticsCopy } from '@/components/analytics/analytics-copy';
import { InstagramSupportLink } from '@/components/support/instagram-support-link';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';

export function Footer() {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const messages = getVisibleCopy(activeLocale);
  const copy = messages.footer;

  return (
    <footer className="ticket-footer mt-auto md:min-h-[120px]">
      <div className="ticket-container py-4 md:py-10">
        <p className="text-caption text-gray-600 md:mb-4">
          {copy.support} · <InstagramSupportLink copy={messages.support} />
        </p>
        <div className="hidden md:block">
          <Link href={getLocalizedPathname('/legal/analytics', activeLocale)} className="mb-3 inline-block text-xs text-muted-foreground underline">{analyticsCopy(activeLocale).settings}</Link>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
            <Link href={getLocalizedPathname('/legal/terms', activeLocale)} className="hover:underline">
              {copy.terms}
            </Link>
            <span className="text-gray-400">|</span>
            <Link href={getLocalizedPathname('/legal/privacy', activeLocale)} className="font-semibold hover:underline">
              {copy.privacy}
            </Link>
            <span className="text-gray-400">|</span>
            <Link href={getLocalizedPathname('/support', activeLocale)} className="hover:underline">
              {copy.support}
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-500">&copy; 2026 Grabit. All rights reserved.</p>
          <div className="mt-4 grid gap-2 text-caption leading-relaxed text-gray-600 sm:grid-cols-2">
            <p>{copy.businessName}</p>
            <p>{copy.representative}</p>
            <p>{copy.businessRegistration}</p>
            <p>{copy.mailOrderRegistration}</p>
            <p>{copy.businessAddress}</p>
            <p>{copy.privacyOfficer}</p>
            <p>
              {copy.privacyInquiry}{' '}
              <a href="mailto:privacy@heygrabit.com" className="hover:underline">
                privacy@heygrabit.com
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
