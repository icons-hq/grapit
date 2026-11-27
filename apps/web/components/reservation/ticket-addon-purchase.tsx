'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { BookingAddonChoice, ReservationDetail, SupportedLocale, TicketAddonOptions } from '@grabit/shared';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { Button } from '@/components/ui/button';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { apiClient } from '@/lib/api-client';
import { getTicketAddonCopy } from '@/lib/booking/ticket-addon-copy';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';

type Props = { reservation: ReservationDetail; ticketId: string; locale: SupportedLocale; canBuy: boolean };

export function TicketAddonPurchase(props: Props) {
  const [open, setOpen] = useState(false);
  const copy = getTicketAddonCopy(props.locale);
  return <section className="mt-4 border-t pt-4">
    <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
      {props.canBuy ? copy.title : copy.history}
    </Button>
    {open && <TicketAddonSelection {...props} />}
  </section>;
}

function TicketAddonSelection({ reservation, ticketId, locale, canBuy }: Props) {
  const router = useRouter();
  const buyer = useAuthStore(store => store.user?.id);
  const copy = getTicketAddonCopy(locale);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const { data, isError, refetch } = useQuery({
    queryKey: ['ticket-addons', buyer, ticketId],
    queryFn: () => apiClient.get<TicketAddonOptions>(`/api/v1/ticket-items/${ticketId}/addons`, { showErrorToast: false }),
    staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 5000, retry: false,
  });
  if (isError) return <Button variant="ghost" onClick={() => void refetch()}>{copy.retry}</Button>;
  if (!data) return <p className="mt-3 text-sm" role="status">{copy.loading}</p>;
  const money = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value);
  const checkout = getLocalizedPathname(`/booking/${reservation.performanceId}/confirm`, locale);
  const pending = data.orders.find(order => order.status === 'PENDING_PAYMENT');
  const offers = canBuy ? data.offers.filter(offer => offer.remainingUnits.length > 0) : [];
  const selected: BookingAddonChoice[] = offers.flatMap(offer => offer.remainingUnits.slice(0, Math.min(offer.available, quantities[offer.id] ?? 0)).map(unitIndex => ({
    addonId: offer.id, seatKey: data.seatKey, unitIndex, price: offer.price, displayCopy: offer.displayCopy,
    // Selection on this screen does not hold inventory. Prepare returns the actual order deadline.
    expiresAt: reservation.showDateTime,
  })));
  function proceed() {
    if (!selected.length || !reservation.showtimeId || !reservation.performanceId) return;
    useBookingStore.getState().setBookingData({ selectedSeats: [], selectedAddons: selected,
      holderTicket: { id: ticketId, reservationId: reservation.id }, showtimeId: reservation.showtimeId,
      performanceId: reservation.performanceId, performanceTitle: reservation.performanceTitle, showDateTime: reservation.showDateTime,
      venue: reservation.venue, posterUrl: reservation.posterUrl, expiresAt: null });
    router.push(`${checkout}?ticketId=${ticketId}&parentId=${reservation.id}`);
  }
  return <div className="mt-3 space-y-3">
    {pending ? <Link className="text-sm font-semibold text-primary underline" href={`${checkout}?resumeOrderId=${encodeURIComponent(pending.orderId)}`}>{copy.pending} · {money(pending.amount)}</Link>
      : offers.length ? <>
          {offers.map(offer => {
            const limit = Math.min(offer.available, offer.remainingUnits.length);
            const name = (offer.displayCopy[locale] ?? offer.displayCopy.en).name;
            return <label key={offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <span><strong>{name}</strong><span className="block text-muted-foreground">{money(offer.price)}{limit === 0 && <> · {getVisibleCopy(locale).bookingAddons.unavailable}</>}</span></span>
              <select aria-label={`${name} · ${copy.qty}`} disabled={limit === 0} className="rounded border bg-background p-2"
                value={Math.min(limit, quantities[offer.id] ?? 0)} onChange={e => setQuantities({ ...quantities, [offer.id]: Number(e.target.value) })}>
                {Array.from({ length: limit + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>;
          })}
          <Button type="button" disabled={!selected.length} onClick={proceed}>{copy.next} · {money(selected.reduce((sum, item) => sum + item.price, 0))}</Button>
        </> : <p className="text-sm text-muted-foreground">{copy.empty}</p>}
    {data.orders.filter(order => order !== pending).map(order => {
      const status = order.refundStatus === 'failed' ? copy.failed : order.refundStatus === 'completed' ? copy.refunded
        : order.refundStatus ? copy.refunding : order.status === 'CONFIRMED' ? copy.paid : copy.cancelled;
      return <p key={order.orderId} className="text-sm">{status} · {money(order.refundableAmount ?? order.amount)}</p>;
    })}
    {(offers.length > 0 || data.orders.length > 0) && <p className="text-xs leading-relaxed text-muted-foreground">{copy.refundNotice}</p>}
  </div>;
}
