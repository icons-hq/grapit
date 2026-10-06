import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_BOOKING_POLICY, performanceBookingPolicySchema } from '@grabit/shared';

import { KST_DATETIME_INCOMPLETE, KstDateTimeInput } from '../kst-datetime-input';

function ControlledInput({
  initial,
  onCommit,
  onBlur,
}: {
  initial: string | null;
  onCommit: (value: string | null) => void;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <KstDateTimeInput
        aria-label="판매 시작 일시"
        value={value}
        onChange={(next) => { setValue(next); onCommit(next); }}
        onBlur={onBlur}
      />
      <button type="button" onClick={() => setValue('2027-01-02T03:04:00.000Z')}>외부 값 불러오기</button>
    </>
  );
}

/** jsdom has no segmented datetime-local UI, so the browser's badInput report is stubbed. */
function reportBadInput(input: HTMLInputElement, badInput: boolean) {
  Object.defineProperty(input, 'validity', { configurable: true, value: { badInput } });
}

describe('KstDateTimeInput', () => {
  it('keeps the typed text while a year is entered digit by digit and commits only the finished year', () => {
    const onCommit = vi.fn();
    render(<ControlledInput initial="2025-10-01T11:00:00.000Z" onCommit={onCommit} />);
    const input = screen.getByLabelText('판매 시작 일시') as HTMLInputElement;
    // datetime-local normalizes away zero seconds.
    expect(input.value).toBe('2025-10-01T20:00');

    // Chromium emits each intermediate complete value while the year segment is typed.
    for (const intermediate of ['0002-10-01T20:00', '0020-10-01T20:00', '0202-10-01T20:00']) {
      fireEvent.change(input, { target: { value: intermediate } });
      expect(input.value).toBe(intermediate);
      expect(screen.getByRole('alert')).toHaveTextContent('2000년부터 2100년');
      // Unfinished text is committed as-is so validation blocks saving it.
      expect(onCommit).toHaveBeenLastCalledWith(intermediate);
    }

    fireEvent.change(input, { target: { value: '2026-10-01T20:00' } });

    expect(input.value).toBe('2026-10-01T20:00');
    expect(onCommit).toHaveBeenLastCalledWith('2026-10-01T11:00:00.000Z');
    // Never stored as a real (year 0002...) instant that would open sales immediately.
    expect(onCommit).not.toHaveBeenCalledWith(expect.stringMatching(/^0\d{3}-.*Z$/u));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The event sequences below follow Chromium as measured in a real browser: once the
  // value is '' (a segment is empty), editing other segments sends keydown but neither
  // input nor change, and only leaving the input (blur) shows the final badInput.
  it('blocks saving a partially cleared sale start and commits null only after every segment is cleared and the input is left', () => {
    const onCommit = vi.fn();
    const onBlur = vi.fn();
    render(<ControlledInput initial="2025-10-01T11:00:00.000Z" onCommit={onCommit} onBlur={onBlur} />);
    const input = screen.getByLabelText('판매 시작 일시') as HTMLInputElement;
    fireEvent.focus(input);

    // Clearing only the hour segment changes the value to '' with validity.badInput.
    reportBadInput(input, true);
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.change(input, { target: { value: '' } });

    expect(onCommit).toHaveBeenLastCalledWith(KST_DATETIME_INCOMPLETE);
    expect(onCommit).not.toHaveBeenCalledWith(null);
    expect(screen.getByRole('alert')).toHaveTextContent('완성되기 전에는 저장할 수 없습니다');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // An empty sale start would open a selling event at once; the sentinel fails validation.
    const policy = { ...DEFAULT_PERFORMANCE_BOOKING_POLICY, bookingStartsAt: KST_DATETIME_INCOMPLETE };
    expect(performanceBookingPolicySchema.safeParse(policy).success).toBe(false);

    // Clearing the remaining segments sends no input/change; badInput turns false.
    reportBadInput(input, false);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onCommit).toHaveBeenCalledTimes(1);

    fireEvent.blur(input);

    expect(onCommit).toHaveBeenLastCalledWith(null);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks saving when an empty sale start is only partly typed', () => {
    const onCommit = vi.fn();
    render(<ControlledInput initial={null} onCommit={onCommit} />);
    const input = screen.getByLabelText('판매 시작 일시') as HTMLInputElement;
    fireEvent.focus(input);

    // Typing only the year keeps the value '' and sends no input/change.
    fireEvent.keyDown(input, { key: '2' });
    reportBadInput(input, true);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onCommit).toHaveBeenLastCalledWith(KST_DATETIME_INCOMPLETE);
    expect(screen.getByRole('alert')).toHaveTextContent('날짜와 시각을 끝까지 입력해주세요');
  });

  it('keeps a reopened unfinished sale start when the operator only passes through, and clears it on an edit', () => {
    const onCommit = vi.fn();
    const onBlur = vi.fn();
    render(<ControlledInput initial={KST_DATETIME_INCOMPLETE} onCommit={onCommit} onBlur={onBlur} />);
    const input = screen.getByLabelText('판매 시작 일시') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByRole('alert')).toHaveTextContent('입력란 밖을 눌러주세요');

    // Moving through the empty segments is not an edit and must not save an empty sale start.
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('완성되기 전에는 저장할 수 없습니다');

    // Clearing a segment and leaving commits what the segments show: empty.
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears to null and adopts values loaded from outside the input', () => {
    const onCommit = vi.fn();
    render(<ControlledInput initial={null} onCommit={onCommit} />);
    const input = screen.getByLabelText('판매 시작 일시') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-10-01T20:00' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(onCommit).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: '외부 값 불러오기' }));
    expect(input.value).toBe('2027-01-02T12:04');
  });
});
