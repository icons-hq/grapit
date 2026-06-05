'use client';

import { useEffect, useState } from 'react';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';

export function NetworkBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).network;

  useEffect(() => {
    function handleOffline() {
      setIsOffline(true);
    }
    function handleOnline() {
      setIsOffline(false);
    }

    if (!navigator.onLine) setIsOffline(true);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-[60] flex h-[44px] items-center justify-center gap-3 bg-error text-white"
    >
      <span className="text-caption font-semibold">
        {copy.offline}
      </span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md border border-white bg-transparent px-3 h-8 text-caption text-white"
      >
        {copy.retry}
      </button>
    </div>
  );
}
