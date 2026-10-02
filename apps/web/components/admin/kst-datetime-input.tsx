'use client';

import { useState } from 'react';
import { PERFORMANCE_BOOKING_START_YEAR_RANGE } from '@grabit/shared';
import { Input } from '@/components/ui/input';
import { formatAdminKstDateTime, parseAdminKstDateTimeInput } from '@/lib/admin-datetime';

interface KstDateTimeInputProps {
  /** UTC ISO instant, null when empty, or the operator's unfinished text. */
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  onBlur?: () => void;
  'aria-label': string;
  yearRange?: { min: number; max: number };
}

const toText = (value: string | null | undefined) => (value ? formatAdminKstDateTime(value) : '');

/**
 * A KST `datetime-local` input that keeps the operator's own text while typing.
 *
 * Browsers emit intermediate complete values (year 0002, 0020, 0202...) while a
 * year is typed digit by digit. Re-deriving the displayed text from the committed
 * instant on every keystroke made those values unrepresentable and blanked the
 * input. Only a complete value inside the allowed year range is committed as an
 * instant; anything else is committed as-is so validation blocks saving instead
 * of silently keeping an older time the input no longer shows.
 */
export function KstDateTimeInput({
  value,
  onChange,
  onBlur,
  yearRange = PERFORMANCE_BOOKING_START_YEAR_RANGE,
  'aria-label': ariaLabel,
}: KstDateTimeInputProps) {
  const [text, setText] = useState(() => toText(value));
  const [incomplete, setIncomplete] = useState(false);
  // The value this input last committed or adopted from its parent.
  const [syncedValue, setSyncedValue] = useState<string | null>(value ?? null);

  if ((value ?? null) !== syncedValue) {
    // Only external changes (draft load, form reset) replace what the operator typed.
    setSyncedValue(value ?? null);
    setText(toText(value));
    setIncomplete(false);
  }

  const outOfRange = text !== '' && parseAdminKstDateTimeInput(text, yearRange) === null;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    setText(raw);
    // A partially typed value reports '' with validity.badInput in Chromium.
    setIncomplete(raw === '' && event.target.validity?.badInput === true);
    const next = raw === '' ? null : parseAdminKstDateTimeInput(raw, yearRange) ?? raw;
    setSyncedValue(next);
    onChange(next);
  }

  return (
    <>
      <Input
        type="datetime-local"
        step="1"
        aria-label={ariaLabel}
        aria-invalid={outOfRange || incomplete}
        min={`${yearRange.min}-01-01T00:00`}
        max={`${yearRange.max}-12-31T23:59:59`}
        value={text}
        onChange={handleChange}
        onBlur={onBlur}
      />
      {outOfRange && (
        <span role="alert" className="block text-xs font-normal text-red-600">
          {yearRange.min}년부터 {yearRange.max}년 사이의 날짜와 시각을 끝까지 입력해주세요. 완성되기 전에는 저장할 수 없습니다.
        </span>
      )}
      {incomplete && (
        <span role="alert" className="block text-xs font-normal text-red-600">
          날짜와 시각을 끝까지 입력해주세요. 완성되지 않은 값은 비어 있는 것으로 처리됩니다.
        </span>
      )}
    </>
  );
}
