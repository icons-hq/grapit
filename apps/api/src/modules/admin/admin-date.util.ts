const KST_OFFSET_MINUTES = 9 * 60;
const EXPLICIT_TIMEZONE_RE = /(?:Z|[+-]\d{2}:\d{2})$/u;
const ADMIN_LOCAL_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/u;

export function parseAdminKstDateTime(value: string): Date {
  if (EXPLICIT_TIMEZONE_RE.test(value)) {
    return new Date(value);
  }

  const match = ADMIN_LOCAL_DATETIME_RE.exec(value);
  if (!match) {
    return new Date(value);
  }

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const utcMs =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    KST_OFFSET_MINUTES * 60 * 1000;

  return new Date(utcMs);
}
