import { TICKET_SERVICE_FEE_KRW, type ReservationDetail, type SupportedLocale } from '@grabit/shared';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { getPaymentRecoveryCopy } from '@/lib/booking/payment-recovery-copy';

function formatPrice(amount: number, locale: SupportedLocale) {
  return locale === 'ko' ? `${amount.toLocaleString('ko-KR')}원`
    : new Intl.NumberFormat(locale, { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(amount);
}

/** Read frozen order items, never today's catalog prices or a new FX quote. */
export function ReservationAmountBreakdown({ reservation, locale }: {
  reservation: Pick<ReservationDetail, 'seats' | 'addons' | 'ticketItems' | 'totalAmount'>;
  locale: SupportedLocale;
}) {
  const copy = getCheckoutCopy(locale);
  const recoveryCopy = getPaymentRecoveryCopy(locale);
  const seatTotal = reservation.seats.reduce((sum, seat) => sum + seat.price, 0);
  const addons = reservation.addons ?? [];
  const addonTotal = addons.reduce((sum, addon) => sum + addon.price, 0);
  const addonGroups = new Map<string, { addon: (typeof addons)[number]; quantity: number; amount: number }>();
  for (const addon of addons) {
    const key = `${addon.addonId}:${addon.seatKey}`;
    const group = addonGroups.get(key);
    if (group) { group.quantity += 1; group.amount += addon.price; }
    else addonGroups.set(key, { addon, quantity: 1, amount: addon.price });
  }
  const fees = reservation.ticketItems.length === reservation.seats.length && reservation.ticketItems.length > 0
    ? reservation.ticketItems.reduce((sum, item) => sum + item.serviceFee, 0)
    : reservation.seats.length * TICKET_SERVICE_FEE_KRW;
  const row = (label: string, amount: number, key: string) => (
    <div key={key} className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-semibold tabular-nums">{formatPrice(amount, locale)}</dd>
    </div>
  );
  return (
    <dl>
      {row(copy.ticketAmount, seatTotal, 'tickets')}
      {[...addonGroups.entries()].map(([key, { addon, quantity, amount }]) => {
        const seat = reservation.seats.find(item => item.seatKey === addon.seatKey);
        const label = seat ? copy.seat.replace(/\{(\w+)\}/g, (_, key: string) => String(seat[key as keyof typeof seat] ?? '')) : addon.seatKey;
        return row(`${addon.displayCopy[locale]?.name ?? addon.displayCopy.en.name} × ${quantity} · ${label}`, amount, key);
      })}
      {row(copy.serviceFee, fees, 'fee')}
      <div className="border-t">{row(copy.orderTotal, reservation.totalAmount, 'total')}</div>
      {seatTotal + addonTotal + fees !== reservation.totalAmount && <p role="alert" className="py-2 text-sm text-amber-800">{recoveryCopy.amountMismatch}</p>}
    </dl>
  );
}
