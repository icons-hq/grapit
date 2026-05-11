const BOOKING_TIME_ZONE = 'Asia/Seoul';

type CalendarParts = {
  year: number;
  month: number;
  day: number;
};

const kstDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOOKING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const kstDateLabelFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: BOOKING_TIME_ZONE,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

const kstTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: BOOKING_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function toDate(input: string | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

function getKstCalendarParts(input: string | Date): CalendarParts {
  const values = Object.fromEntries(
    kstDatePartsFormatter
      .formatToParts(toDate(input))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function getLocalCalendarKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function getKstCalendarKey(input: string | Date): string {
  const parts = getKstCalendarParts(input);
  return [
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

export function getKstCalendarDate(input: string | Date): Date {
  const parts = getKstCalendarParts(input);
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function isSameKstCalendarDate(
  showtimeDateTime: string | Date,
  selectedCalendarDate: Date,
): boolean {
  return getKstCalendarKey(showtimeDateTime) === getLocalCalendarKey(selectedCalendarDate);
}

export function formatKstDateLabel(input: string | Date): string {
  return kstDateLabelFormatter.format(toDate(input));
}

export function formatKstTimeLabel(input: string | Date): string {
  return kstTimeFormatter.format(toDate(input));
}
