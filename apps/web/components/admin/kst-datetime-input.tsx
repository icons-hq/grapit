'use client';

import { useRef, useState } from 'react';
import { PERFORMANCE_BOOKING_START_YEAR_RANGE } from '@grabit/shared';
import { Input } from '@/components/ui/input';
import { formatAdminKstDateTime, parseAdminKstDateTimeInput } from '@/lib/admin-datetime';

/**
 * Committed while the browser reports a partially filled input (some segments
 * cleared). It is not an ISO instant, so schema validation blocks saving instead
 * of treating the field as empty: an empty sale start opens a selling event at once.
 */
export const KST_DATETIME_INCOMPLETE = 'incomplete';

interface KstDateTimeInputProps {
  /** UTC ISO instant, null when empty, or the operator's unfinished text. */
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  onBlur?: () => void;
  'aria-label': string;
  yearRange?: { min: number; max: number };
}

const toText = (value: string | null | undefined) =>
  (value && value !== KST_DATETIME_INCOMPLETE ? formatAdminKstDateTime(value) : '');

/** Keys that only move between segments or leave the input. Any other key may edit one. */
const NAVIGATION_KEYS = new Set([
  'Tab', 'ArrowLeft', 'ArrowRight', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'Enter',
]);

/** What the segments show: the value plus whether a '' value is partly filled. */
const segmentState = (input: HTMLInputElement) => `${input.value}|${input.validity?.badInput === true}`;

/**
 * A KST `datetime-local` input that keeps the operator's own text while typing.
 *
 * Browsers emit intermediate complete values (year 0002, 0020, 0202...) while a
 * year is typed digit by digit. Re-deriving the displayed text from the committed
 * instant on every keystroke made those values unrepresentable and blanked the
 * input. Only a complete value inside the allowed year range is committed as an
 * instant; anything else is committed as-is so validation blocks saving instead
 * of silently keeping an older time the input no longer shows. Only a fully
 * cleared input commits null; edits that keep the value '' are committed when
 * focus leaves the input.
 */
export function KstDateTimeInput({
  value,
  onChange,
  onBlur,
  yearRange = PERFORMANCE_BOOKING_START_YEAR_RANGE,
  'aria-label': ariaLabel,
}: KstDateTimeInputProps) {
  const [text, setText] = useState(() => toText(value));
  const [incomplete, setIncomplete] = useState(() => value === KST_DATETIME_INCOMPLETE);
  // The value this input last committed or adopted from its parent.
  const [syncedValue, setSyncedValue] = useState<string | null>(value ?? null);
  // Segment state when focus entered the input, and whether a key that can edit a
  // segment was pressed since then.
  const focusedState = useRef<string | null>(null);
  const editedSinceFocus = useRef(false);

  if ((value ?? null) !== syncedValue) {
    // Only external changes (draft load, form reset) replace what the operator typed.
    setSyncedValue(value ?? null);
    setText(toText(value));
    setIncomplete(value === KST_DATETIME_INCOMPLETE);
  }

  const outOfRange = text !== '' && !incomplete && parseAdminKstDateTimeInput(text, yearRange) === null;

  function commit(target: HTMLInputElement) {
    const raw = target.value;
    // A partially typed (or partially cleared) value reports '' with validity.badInput
    // in Chromium. Committing null here would save an empty sale start.
    const partial = raw === '' && target.validity?.badInput === true;
    const next = partial
      ? KST_DATETIME_INCOMPLETE
      : raw === '' ? null : parseAdminKstDateTimeInput(raw, yearRange) ?? raw;
    setText(raw);
    setIncomplete(partial);
    if (next === syncedValue) return;
    setSyncedValue(next);
    onChange(next);
  }

  function handleFocus(event: React.FocusEvent<HTMLInputElement>) {
    focusedState.current = segmentState(event.currentTarget);
    editedSinceFocus.current = false;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!NAVIGATION_KEYS.has(event.key)) editedSinceFocus.current = true;
  }

  function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
    // Chromium emits neither input nor change while the value stays '' (clearing
    // the remaining segments of a partial value, typing into an empty input), so
    // what the segments show is committed when focus leaves the input: all empty
    // commits null, partly filled commits the incomplete sentinel. Only an edit
    // made in this visit is committed, so tabbing through a reopened unfinished
    // value does not quietly turn it into an empty sale start.
    const target = event.currentTarget;
    if (
      target.value === ''
      && (editedSinceFocus.current || segmentState(target) !== focusedState.current)
    ) {
      commit(target);
    }
    onBlur?.();
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
        onChange={(event) => commit(event.target)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {outOfRange && (
        <span role="alert" className="block text-xs font-normal text-red-600">
          {yearRange.min}년부터 {yearRange.max}년 사이의 날짜와 시각을 끝까지 입력해주세요. 완성되기 전에는 저장할 수 없습니다.
        </span>
      )}
      {incomplete && (
        <span role="alert" className="block text-xs font-normal text-red-600">
          날짜와 시각을 끝까지 입력해주세요. 완성되기 전에는 저장할 수 없습니다. 비우려면 모든 칸을 지운 뒤 입력란 밖을 눌러주세요.
        </span>
      )}
    </>
  );
}
