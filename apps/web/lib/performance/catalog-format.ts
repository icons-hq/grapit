/** Performance dates describe the event period; exact showtimes are selected later. */
export function formatCatalogDateRange(start: string, end: string, locale: string): string | null {
  const first = new Date(start);
  if (!Number.isFinite(first.getTime())) return null;
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Asia/Seoul', calendar: 'gregory' });
  const from = formatter.format(first);
  const last = new Date(end);
  const to = Number.isFinite(last.getTime()) ? formatter.format(last) : from;
  return `${from === to ? from : `${from} – ${to}`} KST`;
}
