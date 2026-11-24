'use client';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { setAnalyticsChoice } from '@/lib/analytics-client';
import { analyticsCopy } from './analytics-copy';

export function AnalyticsConsentControls({ disabled }: { disabled: boolean }) {
  const locale = useLocale(); const labels = getVisibleCopy(locale).analyticsChoices; const copy = analyticsCopy(locale);
  const [collection, setCollection] = useState(false); const [overseas, setOverseas] = useState(false);
  return <section id="visitor-consent" data-analytics-consent className="scroll-mt-20 space-y-4 rounded-lg border p-4">
    <p className="text-sm">{labels.choose}</p>
    <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={collection} onCheckedChange={(value) => setCollection(value === true)} disabled={disabled} className="mt-1" /><span>{labels.collect}</span></label>
    <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={overseas} onCheckedChange={(value) => setOverseas(value === true)} disabled={disabled} className="mt-1" /><span>{labels.transfer}</span></label>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={disabled || !collection || !overseas} onClick={() => setAnalyticsChoice('accepted', { collectionConsent: collection, overseasConsent: overseas })}>{copy.accept}</Button><Button variant="outline" onClick={() => setAnalyticsChoice('declined')}>{copy.decline}</Button></div>
  </section>;
}
