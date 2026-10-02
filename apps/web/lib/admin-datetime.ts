const EXPLICIT_TIMEZONE_RE = /(?:Z|[+-]\d{2}:\d{2})$/u;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/**
 * Admin times are entered and stored as fixed UTC+09:00, matching the API's
 * parseAdminKstDateTime. Intl's Asia/Seoul zone would apply historical local
 * mean time to implausible years and emit unpadded years, turning a mistyped
 * value into a string a datetime-local input cannot display.
 */
function formatKstParts(value: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} | null {
  if (!EXPLICIT_TIMEZONE_RE.test(value)) return null;

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const kst = new Date(ms + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();

  return {
    year: year < 0 ? `-${pad(-year, 6)}` : pad(year, 4),
    month: pad(kst.getUTCMonth() + 1),
    day: pad(kst.getUTCDate()),
    hour: pad(kst.getUTCHours()),
    minute: pad(kst.getUTCMinutes()),
    second: pad(kst.getUTCSeconds()),
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

/**
 * Converts a complete `datetime-local` value entered as KST into a UTC ISO
 * instant. Returns null for partial input or a year outside the allowed range so
 * the caller can keep the operator's text instead of committing a bogus instant.
 */
export function parseAdminKstDateTimeInput(
  value: string,
  yearRange: { min: number; max: number },
): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  if (Number(year) < yearRange.min || Number(year) > yearRange.max) return null;
  const utc = new Date(0);
  utc.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  utc.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const ms = utc.getTime() - KST_OFFSET_MS;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
