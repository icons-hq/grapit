'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { formatCopy, getClientVisibleCopy } from '@/lib/i18n/client-copy';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const copy = getClientVisibleCopy().commonErrors;

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
      <h2 className="text-heading font-semibold text-gray-900">
        {copy.server}
      </h2>
      <p className="text-base text-gray-500">
        {copy.default}
      </p>
      {error instanceof ApiClientError && (
        <p className="text-caption text-gray-500">
          {formatCopy(copy.errorCode, { status: error.statusCode })}
        </p>
      )}
      <Button onClick={reset}>{copy.retry}</Button>
    </main>
  );
}
