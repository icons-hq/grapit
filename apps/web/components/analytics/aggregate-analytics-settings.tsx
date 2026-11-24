'use client';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { useSyncExternalStore } from 'react';
import { useLocale } from 'next-intl';
import { aggregateAnalyticsDisabled, setAggregateAnalyticsDisabled, subscribeAggregateChoice } from '@/lib/analytics-counts-client';
import { Button } from '@/components/ui/button';

export function AggregateAnalyticsSettings({ active }: { active: boolean }) {
  const locale = useLocale(); const labels = getVisibleCopy(locale).usageCounts;
  const disabled = useSyncExternalStore(subscribeAggregateChoice, aggregateAnalyticsDisabled, () => true);
  return <section className="flex flex-col gap-4 rounded-xl border p-5">
    <h2 className="text-xl font-semibold">{labels.title}</h2>
    <p className="text-sm leading-7">{labels.summary}</p>
    <p className="text-sm leading-7">{labels.choices}</p>
    <p role="status" className="text-sm">{!active ? (labels.serverOff) : disabled ? (labels.off) : (labels.on)}</p>
    <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => setAggregateAnalyticsDisabled(true)}>{labels.disable}</Button><Button variant="outline" disabled={!active} onClick={() => setAggregateAnalyticsDisabled(false)}>{labels.enable}</Button></div>
  </section>;
}
