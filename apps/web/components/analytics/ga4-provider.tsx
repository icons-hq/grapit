'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { normalizeGa4Path, isAdultForGoogleInterests, type Ga4Config } from '@grabit/shared';
import { getGa4Choice, getGa4AdultConfirmed, setGa4Choice, stopGa4, subscribeGa4Choice, updateGa4 } from '@/lib/ga4-client';
import { analyticsPrivacySignal, getAnalyticsChoice, subscribeAnalyticsChoice } from '@/lib/analytics-client';
import { apiClient } from '@/lib/api-client';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field';
import { useAuthStore } from '@/stores/use-auth-store';
import { useHydrated } from '@/hooks/use-hydrated';
import { AnalyticsConsentBanner } from './analytics-consent-banner';

export function useGa4Config() {
  return useQuery({ queryKey: ['audience', 'ga4-config'], queryFn: () => apiClient.get<Ga4Config>('/api/v1/analytics/audience/ga4-config', { showErrorToast: false }), staleTime: 30_000, refetchInterval: (query) => query.state.data?.enabled ? 30_000 : false, refetchIntervalInBackground: false, retry: false });
}
export function Ga4Provider() {
  const config = useGa4Config(); const pathname = usePathname(); const search = useSearchParams().toString();
  const choice = useSyncExternalStore(subscribeGa4Choice, getGa4Choice, () => null);
  const adultConfirmed = useSyncExternalStore(subscribeGa4Choice, getGa4AdultConfirmed, () => false);
  const ownChoice = useSyncExternalStore(subscribeAnalyticsChoice, getAnalyticsChoice, () => null);
  const authReady = useAuthStore((s) => s.isInitialized);
  const role = useAuthStore((s) => s.user?.role);
  const birthday = useAuthStore((s) => s.user?.birthDate);
  const adultAccount = role === 'user' && isAdultForGoogleInterests(birthday);
  const accountEligible = !role || adultAccount;
  const locale = resolveVisibleCopyLocale(useLocale()); const labels = getVisibleCopy(locale).googleAnalytics;
  useEffect(() => {
    const sync = () => updateGa4(config.isError || !authReady || !accountEligible ? undefined : config.data, pathname, adultAccount);
    sync();
    // Also enforce expiry/privacy choices on a long-lived page without traffic.
    const timer = choice === 'accepted' ? window.setInterval(sync, 30_000) : null;
    window.addEventListener('focus', sync);
    return () => { if (timer !== null) window.clearInterval(timer); window.removeEventListener('focus', sync); stopGa4(); };
  }, [config.data, config.isError, pathname, search, choice, authReady, accountEligible, adultAccount, adultConfirmed]);
  if (!authReady || !accountEligible || config.isError || !config.data?.enabled || choice !== null || ownChoice === null || analyticsPrivacySignal() || !normalizeGa4Path(pathname)) return null;
  const detailsHref = getLocalizedPathname('/legal/analytics', locale);
  return <AnalyticsConsentBanner label={labels.option} detailsHref={`${detailsHref}#google`} onAccept={() => setGa4Choice(true)} onDecline={() => setGa4Choice(false)} />;
}
export function Ga4ChoiceControls({ enabled }: { enabled: boolean }) {
  const locale = useLocale(); const labels = getVisibleCopy(locale).googleAnalytics;
  const user = useAuthStore((s) => s.user);
  const eligible = enabled && (!user || (user.role === 'user' && isAdultForGoogleInterests(user.birthDate)));
  const choice = useSyncExternalStore(subscribeGa4Choice, getGa4Choice, () => null);
  const adultConfirmed = useSyncExternalStore(subscribeGa4Choice, getGa4AdultConfirmed, () => false);
  const needsAgeConfirmation = choice === 'accepted' && !adultConfirmed && !(user?.role === 'user' && isAdultForGoogleInterests(user.birthDate));
  const [collection, setCollection] = useState(false); const [transfer, setTransfer] = useState(false); const [adult, setAdult] = useState(false); const [error, setError] = useState(false);
  return <div id="google-consent" className="flex scroll-mt-20 flex-col gap-3" data-analytics-private>
    {choice !== 'accepted' && <FieldSet disabled={!eligible || analyticsPrivacySignal()}><FieldLegend className="sr-only">{labels.choices}</FieldLegend>
      <Field orientation="horizontal"><Checkbox id={`google-collection-${enabled}`} checked={collection} onCheckedChange={(v) => setCollection(v === true)} /><FieldLabel htmlFor={`google-collection-${enabled}`}>{labels.collect}</FieldLabel></Field>
      <Field orientation="horizontal"><Checkbox id={`google-transfer-${enabled}`} checked={transfer} onCheckedChange={(v) => setTransfer(v === true)} /><FieldLabel htmlFor={`google-transfer-${enabled}`}>{labels.transfer}</FieldLabel></Field>
      <Field orientation="horizontal"><Checkbox id={`google-adult-${enabled}`} checked={adult} onCheckedChange={(v) => setAdult(v === true)} /><FieldLabel htmlFor={`google-adult-${enabled}`}>{labels.adult}</FieldLabel></Field>
    </FieldSet>}
    {needsAgeConfirmation && <Field orientation="horizontal"><Checkbox id="google-confirm-age" checked={adult} disabled={!eligible || analyticsPrivacySignal()} onCheckedChange={(v) => setAdult(v === true)} /><FieldLabel htmlFor="google-confirm-age">{labels.adult}</FieldLabel></Field>}
    <div className="flex flex-wrap gap-2">{(choice !== 'accepted' || needsAgeConfirmation) && <Button disabled={!eligible || (choice !== 'accepted' && (!collection || !transfer)) || !adult || analyticsPrivacySignal()} onClick={() => setError(!setGa4Choice(true, adult))}>{needsAgeConfirmation ? labels.confirmAge : labels.allow}</Button>}
      <Button variant="outline" onClick={() => { setError(!setGa4Choice(false)); setCollection(false); setTransfer(false); setAdult(false); }}>{choice === 'accepted' ? labels.withdraw : labels.decline}</Button></div>
    {choice !== null && <p role="status" className="text-xs text-muted-foreground">{needsAgeConfirmation ? labels.pendingAge : choice === 'accepted' ? labels.allowed : labels.declined}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{labels.saveError}</p>}
  </div>;
}
export function Ga4ProcessingDetails() {
  const config = useGa4Config(); const locale = useLocale(); const labels = getVisibleCopy(locale).googleAnalytics;
  const hydrated = useHydrated();
  const visibleConfig = hydrated ? config.data : undefined;
  const countries = (visibleConfig?.transferCountries ?? []).map((c) => new Intl.DisplayNames([locale], { type: 'region' }).of(c)).join(', ');
  return <section id="google" className="flex scroll-mt-20 flex-col gap-4 border-t pt-6" data-analytics-private data-analytics-consent>
    <h2 className="text-xl font-semibold">{labels.title}</h2>
    <p className="text-sm leading-7">{labels.purpose}</p>
    <p className="text-sm leading-7">{labels.recipient}</p>
    <p className="text-sm leading-7">{labels.countries}{countries || (labels.unconfirmed)}. {labels.locations}</p>
    <p className="text-sm leading-7">{labels.retention}</p>
    <p className="text-sm leading-7">{labels.withdrawal}</p>
    <p className="text-sm leading-7">{labels.activityIntro}<a className="underline" href="https://myactivity.google.com/myactivity">{labels.activity}</a>{labels.adsIntro}<a className="underline" href="https://myadcenter.google.com/">{labels.ads}</a>{labels.addonIntro}<a className="underline" href="https://tools.google.com/dlpage/gaoptout">{labels.browserAddon}</a>{labels.addonSuffix}</p>
    <p className="text-xs text-muted-foreground"><a className="underline" href="https://business.safety.google/adsprocessorterms/">Google {labels.terms}</a> · <a className="underline" href="https://business.safety.google/adssubprocessors/">{labels.processors}</a> · <a className="underline" href="https://datacenters.google/locations/">{labels.centres}</a> · <a className="underline" href="https://support.google.com/analytics/answer/7667196">{labels.retentionDetails}</a></p>
    {!visibleConfig?.enabled && <p className="text-sm text-muted-foreground">{labels.disabled}</p>}
    <Ga4ChoiceControls enabled={!config.isError && visibleConfig?.enabled === true} />
  </section>;
}
