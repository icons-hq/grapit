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
      // Without an open time the page re-checks periodically; it must not claim
      // that refreshing is unnecessary as if entry were timed to the open.
      expect(screen.getByTestId('queue-open-time-unknown')).toHaveTextContent(
        koQueue.openTimeUnknownInfo.replace('{seconds}', '15'),
      );
      expect(screen.queryByText(koQueue.status.notOpen.helper)).not.toBeInTheDocument();
    });

    it('keeps the no-refresh guidance when the open time is known', () => {
      render(
        <QueueWaiting
          status="notOpen"
          position={0}
          etaSeconds={0}
          remainingSeats={0}
          autoEnter={false}
          bookingOpensAt={Date.now() + 60_000}
        />,
      );

      expect(screen.getByText(koQueue.status.notOpen.helper)).toBeInTheDocument();
      expect(screen.queryByTestId('queue-open-time-unknown')).not.toBeInTheDocument();
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

  it('tells visitors of a missing performance that it was not found instead of "sales ended"', () => {
    const onBack = vi.fn();
    render(
      <QueueWaiting
        status="closed"
        closedReason="notFound"
        position={0}
        etaSeconds={0}
        remainingSeats={0}
        autoEnter={false}
        onBack={onBack}
      />,
    );

    expect(screen.getByRole('heading', { name: koQueue.notFound.title })).toBeInTheDocument();
    expect(screen.queryByText(koQueue.status.closed.description)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: koQueue.backHomeAction }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  describe('wait estimate (audit #91)', () => {
    it('shows the server range for the current admission cycles', () => {
      render(
        <QueueWaiting
          status="waiting"
          position={5_000}
          etaSeconds={4_000}
          etaMinSeconds={2_400}
          remainingSeats={8_000}
          autoEnter={false}
        />,
      );

      expect(screen.getByTestId('queue-metric-eta')).toHaveTextContent('약 40~67분');
      expect(screen.queryByTestId('queue-sold-out-risk')).not.toBeInTheDocument();
    });

    it('never shows "entering soon" for a waiting position without an estimate', () => {
      render(
        <QueueWaiting
          status="waiting"
          position={600}
          etaSeconds={10_800}
          etaUnavailable
          remainingSeats={0}
          autoEnter={false}
        />,
      );

      expect(screen.getByTestId('queue-metric-eta')).toHaveTextContent(koQueue.metrics.etaUnavailable);
      expect(screen.getByTestId('queue-metric-eta')).not.toHaveTextContent(koQueue.metrics.soon);
      expect(screen.getByTestId('queue-sold-out-risk')).toHaveTextContent(koQueue.soldOutRisk);
    });

    it('warns that seats may sell out when more people wait ahead than seats remain', () => {
      render(
        <QueueWaiting
          status="waiting"
          position={600}
          etaSeconds={1_600}
          etaMinSeconds={600}
          remainingSeats={300}
          autoEnter={false}
        />,
      );

      expect(screen.getByTestId('queue-sold-out-risk')).toHaveTextContent(koQueue.soldOutRisk);
    });

    it('does not show a wait estimate on failure surfaces', () => {
      render(
        <QueueWaiting
          status="expired"
          position={0}
          etaSeconds={0}
          remainingSeats={0}
          autoEnter={false}
        />,
      );

      expect(screen.getByTestId('queue-metric-eta')).not.toHaveTextContent(koQueue.metrics.soon);
    });

    it.each([
      [{ etaSeconds: 800, etaMinSeconds: 0, position: 1, remainingSeats: 300 }, '14분 이내'],
      [{ etaSeconds: 1_600, etaMinSeconds: 600, position: 600, remainingSeats: 300 }, '약 10~27분'],
      [{ etaSeconds: 0, position: 0, remainingSeats: 300 }, koQueue.metrics.etaCalculating],
      [{ etaSeconds: 10_800, etaUnavailable: true, position: 12, remainingSeats: 0 }, koQueue.metrics.etaUnavailable],
      [{ etaSeconds: 10_800, etaUnavailable: true, position: 20_000, remainingSeats: 5_000 }, '3시간 넘게 걸릴 수 있음'],
      // Older API responses without the lower bound read as an upper bound.
      [{ etaSeconds: 165, position: 12, remainingSeats: 24 }, '3분 이내'],
    ])('formats %o as %s', (params, expected) => {
      expect(formatQueueEta(params, koQueue.metrics)).toBe(expected);
    });

    it('localizes the estimate range', () => {
      expect(
        formatQueueEta(
          { etaSeconds: 4_000, etaMinSeconds: 2_400, position: 5_000, remainingSeats: 8_000 },
          enMessages.booking.queue.metrics,
        ),
      ).toBe('About 40–67 min');
      expect(
        formatQueueEta(
          { etaSeconds: 800, etaMinSeconds: 0, position: 3, remainingSeats: 300 },
          enMessages.booking.queue.metrics,
        ),
      ).toBe('Within 14 min');
    });
  });
});
