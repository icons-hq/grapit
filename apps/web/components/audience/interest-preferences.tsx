'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AUDIENCE_CONSENT_VERSION, type AudiencePreferences, type AudienceTag, type AudienceTagKind } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldSet, FieldLegend } from '@/components/ui/field';
import { apiClient } from '@/lib/api-client';
import { getAudienceCopy } from '@/lib/i18n/audience-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useAuthStore } from '@/stores/use-auth-store';

export function InterestPreferences() {
  const userId = useAuthStore((s) => s.user?.id);
  const locale = resolveVisibleCopyLocale(useLocale()); const copy = getAudienceCopy(locale);
  const tags = useQuery({ queryKey: ['audience', 'catalog'], queryFn: () => apiClient.get<AudienceTag[]>('/api/v1/analytics/audience/catalog'), staleTime: 60_000 });
  const preferences = useQuery({ queryKey: ['audience', 'me', userId], queryFn: () => apiClient.get<AudiencePreferences>('/api/v1/analytics/audience/me'), enabled: !!userId, retry: 1 });
  if (tags.isError || preferences.isError) return <Card><CardContent><p role="alert">{copy.error}</p><Button onClick={() => { void tags.refetch(); void preferences.refetch(); }}>{copy.retry}</Button></CardContent></Card>;
  if (!tags.data || !preferences.data) return <Skeleton aria-label={copy.loading} className="h-80 w-full" />;
  return <PreferencesForm key={`${userId}:${preferences.data.updatedAt}`} tags={tags.data} initial={preferences.data} userId={userId!} />;
}

function PreferencesForm({ tags, initial, userId }: { tags: AudienceTag[]; initial: AudiencePreferences; userId: string }) {
  const locale = resolveVisibleCopyLocale(useLocale()); const copy = getAudienceCopy(locale); const client = useQueryClient();
  const [selected, setSelected] = useState(initial.tagIds);
  const [consent, setConsent] = useState(!!initial.consentedAt);
  const [useBehavior, setUseBehavior] = useState(!!initial.behaviorSince);
  const [error, setError] = useState(false);
  const save = useMutation({ mutationFn: () => apiClient.put<AudiencePreferences>('/api/v1/analytics/audience/me', { tagIds: selected, collectionConsent: true, consentVersion: AUDIENCE_CONSENT_VERSION, useBehavior }, { showErrorToast: false }),
    onSuccess: (data) => { client.setQueryData(['audience', 'me', userId], data); toast.success(copy.saved); }, onError: () => setError(true) });
  const withdraw = useMutation({ mutationFn: () => apiClient.delete('/api/v1/analytics/audience/me', { showErrorToast: false }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['audience', 'me', userId] }); toast.success(copy.withdrawn); }, onError: () => setError(true) });
  const pending = save.isPending || withdraw.isPending;
  function change(kind: AudienceTagKind, ids: string[]) {
    if (ids.length > 5) return;
    const group = new Set(tags.filter((t) => t.kind === kind).map((t) => t.id));
    setSelected((previous) => [...previous.filter((id) => !group.has(id)), ...ids]);
  }
  return <form onSubmit={(e) => { e.preventDefault(); if (consent && !pending) { setError(false); save.mutate(); } }} data-analytics-private>
    <Card><CardHeader><CardTitle><h1>{copy.title}</h1></CardTitle><CardDescription>{copy.subtitle}<br />{copy.optional}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-8">
        {(['artist', 'activity', 'benefit'] as const).map((kind, index) => <FieldSet key={kind} disabled={pending} className="min-w-0 gap-3"><FieldLegend>{index + 1}. {copy[kind]}</FieldLegend>
          {tags.some((t) => t.kind === kind) ? <ToggleGroup type="multiple" variant="outline" spacing={2} value={selected.filter((id) => tags.some((t) => t.id === id && t.kind === kind))} onValueChange={(ids) => change(kind, ids)} aria-label={copy[kind]} className="max-w-full flex-wrap justify-start">
            {tags.filter((t) => t.kind === kind).map((tag) => <ToggleGroupItem className="h-auto min-h-9 max-w-full whitespace-normal break-words" key={tag.id} value={tag.id} disabled={!selected.includes(tag.id) && selected.filter((id) => tags.some((t) => t.id === id && t.kind === kind)).length >= 5}>{tag.labels[locale as keyof typeof tag.labels] ?? tag.labels.en}</ToggleGroupItem>)}
          </ToggleGroup> : <p className="text-sm text-muted-foreground">{copy.none}</p>}
        </FieldSet>)}
        <FieldSet className="gap-4" disabled={pending}><FieldLegend className="sr-only">{copy.consent}</FieldLegend>
          {locale === 'th' && <p className="text-xs text-muted-foreground">รายละเอียดความยินยอมด้านล่างเป็นภาษาอังกฤษ</p>}
          <p className="text-sm leading-6 text-muted-foreground">{copy.purpose}</p>
          <label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} /><span>{copy.consent}</span></label>
          <label className="flex items-start gap-3 text-sm"><Checkbox checked={useBehavior} onCheckedChange={(v) => setUseBehavior(v === true)} /><span>{copy.behavior}</span></label>
          <p className="text-sm leading-6 text-muted-foreground">{copy.behaviorHint}</p>
          <p className="text-sm text-muted-foreground">{copy.marketing} <Link className="underline" href={`${getLocalizedPathname('/mypage', locale)}?tab=settings`}>{copy.marketingSettings}</Link></p>
        </FieldSet>
        {initial.expiresAt && <p className="text-xs text-muted-foreground">{copy.expires}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(initial.expiresAt))}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{copy.error}</p>}
      </CardContent>
      <CardFooter className="flex-wrap gap-3"><Button type="submit" disabled={!consent || pending}>{save.isPending ? copy.saving : copy.save}</Button><Button variant="ghost" asChild><Link href={getLocalizedPathname('/mypage', locale)}>{copy.skip}</Link></Button>
        {initial.consentedAt && <Button type="button" variant="outline" disabled={pending} onClick={() => { setError(false); withdraw.mutate(); }}>{copy.withdraw}</Button>}
      </CardFooter>
    </Card>
  </form>;
}

export function InterestInvitation({ locale: requestedLocale }: { locale: string }) {
  const locale = resolveVisibleCopyLocale(requestedLocale); const copy = getAudienceCopy(locale);
  return <Card className="my-5"><CardHeader><CardTitle>{copy.title}</CardTitle><CardDescription>{copy.invitation}</CardDescription></CardHeader><CardFooter><Button variant="outline" asChild><Link href={getLocalizedPathname('/mypage/interests', locale)}>{copy.invitationAction}</Link></Button></CardFooter></Card>;
}
