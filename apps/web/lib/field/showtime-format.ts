const KST_SHOWTIME_PARTS = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * One showtime format for the check-in screen (showtime picker, selected
 * showtime, device pending banner and ticket card): `10/03(토) 19:30 KST`.
 * A value that is not a date is shown as given.
 */
export function formatFieldShowtimeKst(value: string | undefined | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(
    KST_SHOWTIME_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;
  return `${parts.month}/${parts.day}(${parts.weekday}) ${parts.hour}:${parts.minute} KST`;
}
