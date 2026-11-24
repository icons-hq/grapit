'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getLocalizedPathname } from '@/lib/i18n/locale-path';
import { Button } from '@/components/ui/button';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(locale).commonErrors;
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
      <h2 className="text-heading font-semibold text-gray-900">
        {copy.authTitle}
      </h2>
      <p className="text-base text-gray-500">
        {copy.authRetryBody}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={reset}>
          {copy.retry}
        </Button>
        <Button asChild>
          <Link href={getLocalizedPathname('/', locale)}>{copy.home}</Link>
        </Button>
      </div>
    </main>
  );
}
