'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  getClientLocale,
  getClientVisibleCopy,
} from '@/lib/i18n/client-copy';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = getClientLocale();
  const copy = getClientVisibleCopy().commonErrors;

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <h2 className="text-xl font-semibold text-gray-900">
          {copy.server}
        </h2>
        <p className="text-base text-gray-500">
          {copy.default}
        </p>
        {error.digest && (
          <p className="text-caption text-gray-500">
            {error.digest}
          </p>
        )}
        <Button onClick={reset}>{copy.retry}</Button>
      </body>
    </html>
  );
}
