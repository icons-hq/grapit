'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { analyticsCopy } from './analytics-copy';

export function AnalyticsConsentBanner({ label, detailsHref, onAccept, acceptDisabled = false, onDecline }: {
  label: string;
  detailsHref: string;
  onAccept: () => void | boolean;
  acceptDisabled?: boolean;
  onDecline: () => void | boolean;
}) {
  const copy = analyticsCopy(useLocale());
  const [saveFailed, setSaveFailed] = useState(false);
  return <aside aria-label={label} data-analytics-private data-analytics-consent className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-h-[calc(100dvh-6rem)] max-w-xl flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-lg md:bottom-4">
    <p className="text-sm leading-6">{copy.bannerSummary}</p>
    <Link className="w-fit text-sm text-muted-foreground underline underline-offset-4" href={detailsHref}>{copy.bannerDetails}</Link>
    <div className="flex gap-2">
      <Button variant="outline" className="flex-1" onClick={() => setSaveFailed(onDecline() === false)}>{copy.bannerDecline}</Button>
      <Button className="flex-1" disabled={acceptDisabled} onClick={() => setSaveFailed(onAccept() === false)}>{copy.bannerAccept}</Button>
    </div>
    {saveFailed && <p role="alert" className="text-sm text-destructive">{copy.saveError}</p>}
  </aside>;
}
