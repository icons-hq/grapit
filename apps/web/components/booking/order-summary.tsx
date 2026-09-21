'use client';

import Image from 'next/image';
import { useLocale } from 'next-intl';
import { Ticket } from 'lucide-react';
import { formatEventTimeWithKstAnchor } from '@/lib/i18n/format';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { Separator } from '@/components/ui/separator';
import { TICKET_SERVICE_FEE_KRW, type ProviderChargeQuote, type SeatSelection } from '@grabit/shared';

type CheckoutSeat = SeatSelection & { seatKey?: string; floorKey?: string; floorLabel?: string };

function formatKrw(amount: number) {
  return `KRW ${amount.toLocaleString('en-US')}`;
}

export function OrderSummary({ performanceTitle, posterUrl, showDateTime, venue, seats }: {
  performanceTitle: string;
  posterUrl: string | null;
  showDateTime: string;
  venue: string;
  seats: CheckoutSeat[];
}) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getCheckoutCopy(locale);
  const eventTime = formatEventTimeWithKstAnchor(showDateTime, locale, { includeLocalTime: false });

  return (
    <section aria-label={copy.performance} className="space-y-7">
      <div className="flex items-start gap-5 md:gap-7">
        <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-lg bg-muted md:w-36">
          {posterUrl ? <Image src={posterUrl} alt={performanceTitle} fill className="object-cover" sizes="(min-width: 768px) 144px, 96px" />
            : <div className="flex size-full items-center justify-center"><Ticket aria-label={copy.noPoster} className="size-8 text-muted-foreground" /></div>}
        </div>
        <div className="min-w-0 space-y-3 py-1 md:py-3">
          <h2 className="text-xl font-semibold leading-snug tracking-tight md:text-2xl">{performanceTitle}</h2>
          <div className="space-y-1 text-sm text-muted-foreground md:text-base">
            <time dateTime={showDateTime}>{eventTime.kst}</time>
            <p>{venue}</p>
          </div>
        </div>
      </div>
      <Separator />
      <div className="space-y-4">
        <h2 className="text-base font-semibold">{copy.seats}</h2>
        <ul className="space-y-3">
          {seats.map((seat) => (
            <li key={seat.seatKey ?? `${seat.floorKey ?? 'default'}:${seat.seatId}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm md:text-base">
              <span>{copy.seat.replace(/\{(\w+)\}/g, (_, key: string) => String(seat[key as keyof CheckoutSeat] ?? ''))}</span>
              <span className="tabular-nums">{formatKrw(seat.price)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function CheckoutAmountSummary({ seats, totalPrice, quote }: {
  seats: CheckoutSeat[];
  totalPrice: number;
  quote?: ProviderChargeQuote;
}) {
  const copy = getCheckoutCopy(resolveVisibleCopyLocale(useLocale()));
  return (
    <section aria-label={copy.paymentTitle} className="space-y-4">
      <h2 className="text-xl font-semibold">{copy.paymentTitle}</h2>
      <dl className="space-y-3 text-sm md:text-base">
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{copy.ticketAmount}</dt><dd className="tabular-nums">{formatKrw(seats.reduce((sum, seat) => sum + seat.price, 0))}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{copy.serviceFee}</dt><dd className="tabular-nums">{formatKrw(seats.length * TICKET_SERVICE_FEE_KRW)}</dd></div>
        <div className="flex justify-between gap-4 border-t border-border pt-4 font-semibold"><dt>{copy.orderTotal}</dt><dd className="tabular-nums">{formatKrw(totalPrice)}</dd></div>
      </dl>
      {quote && (
        <section aria-label={copy.charge} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary/5 p-4 text-primary">
          <h3 className="text-sm font-semibold">{copy.charge}</h3>
          <p className="text-2xl font-bold tabular-nums">{quote.currency} {quote.amountDecimal}</p>
          <p className="w-full text-xs text-muted-foreground">{copy.quoteReady}</p>
        </section>
      )}
    </section>
  );
}
