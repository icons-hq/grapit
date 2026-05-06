const EXPLICIT_TIMEZONE_RE = /(?:Z|[+-]\d{2}:\d{2})$/u;

function formatKstParts(value: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} | null {
  if (!EXPLICIT_TIMEZONE_RE.test(value)) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function formatAdminKstDate(value: string): string {
  const parts = formatKstParts(value);
  if (parts) return `${parts.year}-${parts.month}-${parts.day}`;
  return value.split('T')[0] ?? value;
}

export function formatAdminKstDateTime(value: string): string {
  const parts = formatKstParts(value);
  if (parts) {
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  }
  return value;
}
