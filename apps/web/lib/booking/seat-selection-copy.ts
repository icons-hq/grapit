import { getClientLocale, getClientVisibleCopy } from '@/lib/i18n/client-copy';

export function getSeatSelectionCopy() {
  return getClientVisibleCopy().booking.seatSelection;
}

export function formatSeatSelectionPrice(amount: number) {
  const locale = getClientLocale();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
  return locale === 'ko' ? `${number}원` : `KRW ${number}`;
}
