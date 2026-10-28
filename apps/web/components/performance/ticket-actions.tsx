'use client';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Heart, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFavorites, useToggleFavorite } from '@/hooks/use-ticket-library';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export function TicketActions({ performanceId }: { performanceId: string }) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const router = useRouter();
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const saved = favorites.data?.ids?.includes(performanceId) ?? false;
  function save() {
    if (!favorites.authenticated) {
      const returnTo = getLocalizedPathname(`/performance/${performanceId}`,locale);
      router.push(`${getLocalizedPathname('/auth',locale)}?returnTo=${encodeURIComponent(returnTo)}`); return;
    }
    if (favorites.isError) { void favorites.refetch(); return; }
    toggle.mutate({id:performanceId,saved},{onSuccess:() => toast.success(saved ? copy.unsaved : copy.saved)});
  }
  async function share() {
    try { await navigator.clipboard.writeText(window.location.href); toast.success(copy.copied); }
    catch { toast.error(copy.copyFailed); }
  }
  return <div className="ticket-detail-actions">
    <button type="button" aria-label={copy.share} onClick={() => void share()}><Share2 size={22} strokeWidth={1.6} /></button>
    <button type="button" aria-label={saved ? copy.unsave : copy.save} aria-pressed={saved} disabled={favorites.isLoading || toggle.isPending} onClick={save}><Heart size={24} strokeWidth={1.6} fill={saved ? 'currentColor' : 'none'} /></button>
  </div>;
}
