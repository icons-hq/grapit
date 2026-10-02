import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KstDateTimeInput } from '../kst-datetime-input';

function ControlledInput({ initial, onCommit }: { initial: string | null; onCommit: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <KstDateTimeInput aria-label="판매 시작 일시" value={value} onChange={(next) => { setValue(next); onCommit(next); }} />
      <button type="button" onClick={() => setValue('2027-01-02T03:04:00.000Z')}>외부 값 불러오기</button>
    </>
  );
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
