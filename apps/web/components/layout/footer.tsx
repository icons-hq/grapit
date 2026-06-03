import Link from 'next/link';
import { useLocale } from 'next-intl';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';

export function Footer() {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale).footer;

  return (
    <footer className="mt-auto min-h-[120px] bg-gray-100">
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        {/* Legal links */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
          <Link
            href={getLocalizedPathname('/legal/terms', activeLocale)}
            className="hover:underline"
          >
            {copy.terms}
          </Link>
          <span className="text-gray-400">|</span>
          <Link
            href={getLocalizedPathname('/legal/privacy', activeLocale)}
            className="font-semibold hover:underline"
          >
            {copy.privacy}
          </Link>
          <span className="text-gray-400">|</span>
          <Link
            href={getLocalizedPathname('/support', activeLocale)}
            className="hover:underline"
          >
            {copy.support}
          </Link>
        </div>

        {/* Copyright */}
        <p className="mt-4 text-sm text-gray-500">
          &copy; 2026 Grabit. All rights reserved.
        </p>

        <div className="mt-4 grid gap-2 text-caption leading-relaxed text-gray-600 sm:grid-cols-2">
          <p>{copy.businessName}</p>
          <p>{copy.representative}</p>
          <p>{copy.businessRegistration}</p>
          <p>{copy.mailOrderRegistration}</p>
          <p>{copy.businessAddress}</p>
          <p>{copy.customerSupport}</p>
          <p>{copy.privacyOfficer}</p>
          <p>
            {copy.privacyInquiry}{' '}
            <a href="mailto:privacy@heygrabit.com" className="hover:underline">
              privacy@heygrabit.com
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
