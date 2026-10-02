import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import koMessages from '@/messages/ko.json';
import enMessages from '@/messages/en.json';
import { QueueWaiting, formatQueueEta } from '../queue-waiting';

const { useLocaleMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'ko'),
}));

vi.mock('next-intl', () => ({ useLocale: useLocaleMock }));

const koQueue = koMessages.booking.queue;

describe('QueueWaiting', () => {
  beforeEach(() => {
    useLocaleMock.mockReturnValue('ko');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('not open yet (audit #33)', () => {
    it('shows a countdown to the open time instead of the "too many requests" retry surface', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T09:58:55.000Z'));

      render(
        <QueueWaiting
          status="notOpen"
          position={0}
          etaSeconds={0}
          remainingSeats={0}
          autoEnter={false}
          bookingOpensAt={Date.parse('2026-06-04T10:00:00.000Z')}
          onRetry={vi.fn()}
        />,
      );

      expect(screen.getByRole('heading', { name: koQueue.status.notOpen.title })).toBeInTheDocument();
      expect(screen.queryByText(koQueue.status.retry.title)).not.toBeInTheDocument();
      expect(screen.getByRole('timer')).toHaveTextContent('00:01:05');
      // The page enters automatically; no manual retry button to hammer.
      expect(screen.queryByRole('button', { name: koQueue.retryAction })).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByRole('timer')).toHaveTextContent('00:01:00');

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole('timer')).toHaveTextContent(koQueue.metrics.opening);
    });

    it('explains that the open time is being checked when it is unknown', () => {
      render(
        <QueueWaiting
          status="notOpen"
          position={0}
          etaSeconds={0}
          remainingSeats={0}
          autoEnter={false}
          bookingOpensAt={null}
        />,
      );

      expect(screen.getByRole('timer')).toHaveTextContent(koQueue.metrics.openTimeUnknown);
    });
  });

  it('shows a closed surface with a way back instead of a retry loop', () => {
    const onBack = vi.fn();
    render(
      <QueueWaiting
        status="closed"
        position={0}
        etaSeconds={0}
        remainingSeats={0}
        autoEnter={false}
        onRetry={vi.fn()}
        onBack={onBack}
      />,
    );

    expect(screen.getByRole('heading', { name: koQueue.status.closed.title })).toBeInTheDocument();
    expect(screen.queryByTestId('queue-metric-position')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: koQueue.retryAction })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: koQueue.backAction }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  describe('wait estimate (audit #91)', () => {
    it('does not show a per-position countdown while the estimate is pending', () => {
      render(
        <QueueWaiting
          status="waiting"
          position={600}
          etaSeconds={0}
          etaPending
          remainingSeats={300}
          autoEnter={false}
        />,
      );

      expect(screen.getByTestId('queue-metric-eta')).toHaveTextContent(koQueue.metrics.etaCalculating);
      expect(screen.getByTestId('queue-metric-eta')).not.toHaveTextContent(koQueue.metrics.soon);
    });

    it('shows the measured estimate as a minute range', () => {
      render(
        <QueueWaiting
          status="waiting"
          position={5_000}
          etaSeconds={3_000}
          remainingSeats={8_000}
          autoEnter={false}
        />,
      );

      expect(screen.getByTestId('queue-metric-eta')).toHaveTextContent('약 40~60분');
      expect(screen.queryByTestId('queue-sold-out-risk')).not.toBeInTheDocument();
    });

    it('warns that seats may sell out when more people wait ahead than seats remain', () => {
      render(
        <QueueWaiting
          status="waiting"
          position={600}
          etaSeconds={1_200}
          remainingSeats={300}
          autoEnter={false}
        />,
      );

      expect(screen.getByTestId('queue-sold-out-risk')).toHaveTextContent(koQueue.soldOutRisk);
    });

    it.each([
      [{ etaSeconds: 0, etaPending: true, position: 1 }, koQueue.metrics.soon],
      [{ etaSeconds: 0, etaPending: true, position: 12 }, koQueue.metrics.etaCalculating],
      [{ etaSeconds: 0, etaPending: false, position: 0 }, koQueue.metrics.soon],
      [{ etaSeconds: 45, etaPending: false, position: 3 }, koQueue.metrics.etaUnderMinute],
      [{ etaSeconds: 75, etaPending: false, position: 3 }, '약 1~2분'],
      [{ etaSeconds: 165, etaPending: false, position: 12 }, '약 2~4분'],
    ])('formats %o as %s', (params, expected) => {
      expect(formatQueueEta(params, koQueue.metrics)).toBe(expected);
    });

    it('localizes the estimate range', () => {
      expect(
        formatQueueEta(
          { etaSeconds: 3_000, etaPending: false, position: 5_000 },
          enMessages.booking.queue.metrics,
        ),
      ).toBe('About 40–60 min');
    });
  });
});
