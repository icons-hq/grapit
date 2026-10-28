'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PerformanceWithDetails, SupportedLocale } from '@grabit/shared';
import { DatePicker } from '@/components/booking/date-picker';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getKstCalendarDate, getKstCalendarKey, isSameKstCalendarDate } from '@/lib/booking-datetime';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useShowtimeSalesClock } from '@/hooks/use-showtime-sales-clock';
import { isShowtimeSalesClosed } from '@/lib/booking/showtime-sales';

export function TicketBookingPanel({ performance, locale, available, verificationRequired, disabledMessage }: {
  performance: PerformanceWithDetails; locale: SupportedLocale; available: boolean; verificationRequired: boolean; disabledMessage: string | null | undefined;
}) {
  const copy = getTicketCopy(locale);
  const legacy = getVisibleCopy(locale);
  const now = useShowtimeSalesClock(performance.showtimes);
  const showtimes = useMemo(() => performance.showtimes.filter((item) => !isShowtimeSalesClosed(item.dateTime,now)).sort((a,b) => Date.parse(a.dateTime)-Date.parse(b.dateTime)),[performance.showtimes,now]);
  const [chosenDate,setChosenDate] = useState<Date|null>(null);
  const [chosenId,setChosenId] = useState<string|null>(null);
  const [mobileExpanded,setMobileExpanded] = useState(false);
  const selectedDate = chosenDate ?? (showtimes[0] ? getKstCalendarDate(showtimes[0].dateTime) : null);
  const dayShows = selectedDate ? showtimes.filter((show) => isSameKstCalendarDate(show.dateTime,selectedDate)) : [];
  const selected = dayShows.find((show) => show.id === chosenId) ?? dayShows[0] ?? null;
  const availableDates = useMemo(() => {
    const map = new Map<string,Date>();
    for(const show of showtimes) map.set(getKstCalendarKey(show.dateTime),getKstCalendarDate(show.dateTime));
    return [...map.values()];
  },[showtimes]);
  const bookingHref = getLocalizedPathname(`/booking/${performance.id}`,locale) + (selected ? `?showtimeId=${selected.id}` : '');
  const ended = performance.showtimes.length > 0 && showtimes.length === 0;
  // A selected day's last show can close while another day is still on sale.
  // Keep the mobile calendar reachable so the buyer can choose that other day.
  const canChooseSchedule = available && !ended;
  const canContinue = available && !ended && (selected !== null || performance.showtimes.length === 0);
  const label = verificationRequired ? legacy.performance.verifyCta : legacy.performance.bookCta;
  const cta = canContinue ? <Link className="ticket-book-cta" href={bookingHref}>{label}</Link>
    : <button type="button" disabled className="ticket-book-cta">{!available ? disabledMessage : ended ? copy.noFutureShowtime : copy.selectTimePrompt}</button>;
  const time = (value:string) => new Intl.DateTimeFormat(locale,{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  const schedule = <div className="ticket-booking-panel-body">
        {showtimes.length ? <>
          <div className="ticket-calendar" aria-label={copy.selectDate}><DatePicker availableDates={availableDates} selected={selectedDate}
            onSelect={(date) => { setChosenDate(date); setChosenId(null); }} /></div>
          <fieldset className="ticket-showtimes"><legend className="sr-only">{copy.selectTime}</legend>
            {dayShows.map((show) => <button key={show.id} type="button" className="ticket-showtime" aria-pressed={selected?.id === show.id} onClick={() => setChosenId(show.id)}>
              <strong>{time(show.dateTime)} <span>KST</span></strong><span>{performance.priceTiers.map((tier) => tier.tierName).join(' · ')}</span>
            </button>)}
          </fieldset>
        </> : <p className="ticket-schedule-empty">{ended ? copy.noFutureShowtime : copy.dateTbd}</p>}
      </div>;
  return <>
    <aside className="ticket-booking-panel">{schedule}<div className="ticket-desktop-booking">{cta}</div></aside>
    <Dialog open={mobileExpanded} onOpenChange={setMobileExpanded}>
      <DialogContent className="ticket-dialog ticket-mobile-booking-dialog translate-x-0 translate-y-0 md:-translate-x-1/2 md:-translate-y-1/2" aria-describedby={undefined}>
        <DialogTitle>{copy.selectDate}</DialogTitle>
        {schedule}
        {cta}
      </DialogContent>
      <div className="ticket-mobile-booking">{canChooseSchedule
        ? <DialogTrigger asChild><button type="button" className="ticket-book-cta">{label}</button></DialogTrigger>
        : cta}</div>
    </Dialog>
  </>;
}
