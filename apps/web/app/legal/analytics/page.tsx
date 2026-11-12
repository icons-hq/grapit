'use client';
import { useSyncExternalStore } from 'react';
import { AggregateAnalyticsSettings } from '@/components/analytics/aggregate-analytics-settings';
import { useAnalyticsConfig } from '@/hooks/use-analytics-config';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { analyticsCopy } from '@/components/analytics/analytics-copy';
import { analyticsPrivacySignal, getAnalyticsChoice, getAnalyticsWithdrawalPending, retryAnalyticsWithdrawal, setAnalyticsChoice, subscribeAnalyticsChoice } from '@/lib/analytics-client';
const serverChoice = () => null;
export default function AnalyticsPrivacyPage() {
  const config = useAnalyticsConfig();
  const copy = analyticsCopy(useLocale());
  const pending = useSyncExternalStore(subscribeAnalyticsChoice, getAnalyticsWithdrawalPending, () => false);
  const choice = useSyncExternalStore(subscribeAnalyticsChoice, getAnalyticsChoice, serverChoice);
  return <div className="flex flex-col gap-6">
    <h1 className="text-2xl font-semibold">{copy.settings}</h1><AggregateAnalyticsSettings active={!config.isError && config.data?.aggregateEnabled === true} /><h2 className="text-xl font-semibold">{copy.title}</h2><p className="leading-7">{copy.summary}</p><p className="leading-7">{copy.privacy}</p><p className="leading-7">{copy.storage}</p>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={pending || config.data?.enabled !== true || config.isError} onClick={() => setAnalyticsChoice('accepted')}>{copy.accept}</Button><Button variant="outline" onClick={() => setAnalyticsChoice('declined')}>{copy.decline}</Button></div>
    {pending && <p role="status" className="text-sm">{copy.deletionPending} <Button variant="outline" size="sm" onClick={() => void retryAnalyticsWithdrawal()}>{copy.retry}</Button></p>}
    <p role="status" className="text-sm text-muted-foreground">{choice === 'accepted' ? copy.accepted : choice === 'declined' ? copy.declined : ''}{analyticsPrivacySignal() ? ` · ${copy.signal}` : ''}</p>
  </div>;
}
