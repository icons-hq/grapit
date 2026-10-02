import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { DevicePendingBanner } from '../device-pending-banner';
import type { FieldDevicePendingGroup } from '@/hooks/use-field-offline-queue';

const ME = 'scanner-user-1';
const CURRENT = 'showtime-current';
const OTHER = 'showtime-other';

function group(overrides: Partial<FieldDevicePendingGroup>): FieldDevicePendingGroup {
  return { scannerUserId: ME, showtimeId: OTHER, eventId: 'event', count: 1, oldestAttemptedAt: '2026-10-03T08:00:00.000Z', ...overrides };
}

function renderBanner(props: Partial<Parameters<typeof DevicePendingBanner>[0]> = {}) {
  const onSync = vi.fn();
  render(
    <DevicePendingBanner
      groups={[group({ showtimeId: OTHER, count: 1 }), group({ showtimeId: CURRENT, count: 2 })]}
      currentUserId={ME}
      currentShowtimeId={CURRENT}
      ownPendingCount={3}
      canSync
      isSyncing={false}
      describeShowtime={(id) => (id === OTHER ? { title: '이전 회차', dateTime: '2026-10-03T05:00:00.000Z' } : null)}
      onSelectShowtime={vi.fn()}
      onSync={onSync}
      {...props}
    />,
  );
  return { onSync, banner: screen.getByRole('region', { name: '이 기기의 미동기화 입장 대기' }) };
}

describe('DevicePendingBanner', () => {
  it('names every entry the sync button sends, the current showtime included (audit #117)', () => {
    const { banner } = renderBanner();

    // The heading counts entries hidden from the current showtime list; the button
    // sends all of this account's entries.
    expect(within(banner).getByText('다른 회차·계정의 동기화되지 않은 입장 대기 1건')).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: '이 계정 대기 전체 3건 동기화' })).toBeEnabled();
  });

  it('keeps the sync button visible but disabled without sync permission or connection', () => {
    const { banner, onSync } = renderBanner({ canSync: false });

    const button = within(banner).getByRole('button', { name: '이 계정 대기 전체 3건 동기화' });
    expect(button).toBeVisible();
    expect(button).toBeDisabled();
    expect(onSync).not.toHaveBeenCalled();
  });

  it('offers no sync button when only another account left entries on this device', () => {
    const { banner } = renderBanner({
      groups: [group({ scannerUserId: 'scanner-user-2', count: 2 })],
      ownPendingCount: 0,
    });

    expect(within(banner).getByText(/다른 현장 계정이 이 기기에 저장한 대기 2건/)).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: /동기화/ })).not.toBeInTheDocument();
  });
});
