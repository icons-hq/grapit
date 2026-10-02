import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PerformanceStatus } from '@grabit/shared';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import {
  BOOKING_AVAILABILITY_CHECKING_COPY,
  BOOKING_AVAILABILITY_UNAVAILABLE_COPY,
  BOOKING_DISABLED_COPY,
} from '@/lib/runtime-flags';
import {
  recordServerTimeSample,
  resetServerClockForTests,
} from '@/lib/server-clock';
import { useAuthStore } from '@/stores/use-auth-store';

const { runtimeFlagsMock } = vi.hoisted(() => ({
  runtimeFlagsMock: vi.fn(),
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: runtimeFlagsMock,
}));

const OPENS_AT_ISO = '2026-10-02T11:00:00.000Z'; // 20:00 KST
const OPENS_AT = Date.parse(OPENS_AT_ISO);

type AvailabilityProps = {
  performanceStatus?: PerformanceStatus | null;
  bookingStartsAt?: string | null;
};

function renderAvailability(initialProps: AvailabilityProps = {}) {
  return renderHook((props: AvailabilityProps) => useBookingAvailability(props), {
    initialProps,
  });
}

function resolvedFlags(overrides: Record<string, unknown> = {}) {
  return {
    bookingEnabled: true,
    locale: 'ko',
    isLoading: false,
    isResolved: true,
    isError: false,
    refetch: vi.fn(),
    bookingDisabledMessage: BOOKING_DISABLED_COPY.ko,
    ...overrides,
  };
}

describe('useBookingAvailability opening time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetServerClockForTests();
    useAuthStore.setState({ user: null });
    runtimeFlagsMock.mockReturnValue(resolvedFlags());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens when the detail response lands after the opening instant (audit #35)', () => {
    vi.setSystemTime(OPENS_AT - 2_000); // page opened at 19:59:58
    const { result, rerender } = renderAvailability();

    // GET /performances/:id answers at 20:00:02.
    act(() => {
      vi.setSystemTime(OPENS_AT + 2_000);
    });
    rerender({ performanceStatus: 'selling', bookingStartsAt: OPENS_AT_ISO });

    expect(result.current.bookingOpen).toBe(true);
    expect(result.current.bookingAvailable).toBe(true);
  });

  it('opens at the server opening instant for a device clock 90 seconds slow (audit #97)', () => {
    vi.setSystemTime(OPENS_AT - 90_000 + 500); // device shows 19:58:30.5
    const { result } = renderAvailability({
      performanceStatus: 'upcoming',
      bookingStartsAt: OPENS_AT_ISO,
    });
    expect(result.current.bookingOpen).toBe(false);

    // /api/runtime-flags reports the server already at 20:00:00.5.
    act(() => {
      recordServerTimeSample({
        serverNowMs: OPENS_AT + 500,
        requestStartedAtMs: Date.now() - 50,
        responseReceivedAtMs: Date.now() + 50,
      });
    });

    expect(result.current.bookingOpen).toBe(true);
  });

  it('stays closed until the server instant for a device clock that runs fast', () => {
    vi.setSystemTime(OPENS_AT + 30_000); // device already shows 20:00:30
    recordServerTimeSample({
      serverNowMs: OPENS_AT - 10_000, // server is at 19:59:50
      requestStartedAtMs: Date.now() - 50,
      responseReceivedAtMs: Date.now() + 50,
    });

    const { result } = renderAvailability({
      performanceStatus: 'upcoming',
      bookingStartsAt: OPENS_AT_ISO,
    });
    expect(result.current.bookingOpen).toBe(false);
    expect(result.current.bookingDisabledMessage).toBe(BOOKING_DISABLED_COPY.ko);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.bookingOpen).toBe(true);
  });

  it('re-evaluates when a sleeping tab becomes visible again', () => {
    vi.setSystemTime(OPENS_AT - 60_000);
    const { result } = renderAvailability({
      performanceStatus: 'selling',
      bookingStartsAt: OPENS_AT_ISO,
    });
    expect(result.current.bookingOpen).toBe(false);

    // The device slept through the opening; no timer has fired yet.
    act(() => {
      vi.setSystemTime(OPENS_AT + 5_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.bookingOpen).toBe(true);
  });
});

describe('useBookingAvailability runtime flag state', () => {
  beforeEach(() => {
    resetServerClockForTests();
    useAuthStore.setState({ user: null });
  });

  it('says it is still checking instead of "opens later" while the flag is unknown', () => {
    runtimeFlagsMock.mockReturnValue(
      resolvedFlags({ bookingEnabled: false, isResolved: false, isLoading: true }),
    );

    const { result } = renderAvailability({ performanceStatus: 'selling' });

    expect(result.current.bookingAvailable).toBe(false);
    expect(result.current.bookingDisabledMessage).toBe(
      BOOKING_AVAILABILITY_CHECKING_COPY.ko,
    );
  });

  it('reports a failed flag check separately from a disabled flag', () => {
    runtimeFlagsMock.mockReturnValue(
      resolvedFlags({ bookingEnabled: false, isResolved: false, isError: true }),
    );

    const { result } = renderAvailability({ performanceStatus: 'selling' });

    expect(result.current.bookingAvailable).toBe(false);
    expect(result.current.bookingDisabledMessage).toBe(
      BOOKING_AVAILABILITY_UNAVAILABLE_COPY.ko,
    );
  });

  it('keeps the disabled copy when the flag really is off', () => {
    runtimeFlagsMock.mockReturnValue(resolvedFlags({ bookingEnabled: false }));

    const { result } = renderAvailability({ performanceStatus: 'selling' });

    expect(result.current.bookingAvailable).toBe(false);
    expect(result.current.bookingDisabledMessage).toBe(BOOKING_DISABLED_COPY.ko);
  });
});

describe('useBookingAvailability Admin Booking Bypass (audit #25)', () => {
  function adminUser(overrides: Record<string, unknown> = {}) {
    return {
      id: 'admin-1',
      email: 'staff@example.test',
      name: '운영자',
      phone: '+821012345678',
      gender: 'unspecified',
      country: 'KR',
      birthDate: '1990-01-01',
      preferredLocale: 'ko',
      isEmailVerified: true,
      isPhoneVerified: true,
      marketingConsent: false,
      role: 'admin',
      adminCapabilityBundle: 'admin',
      adminCapabilities: [],
      createdAt: '2026-05-20T00:00:00.000Z',
      ...overrides,
    } as never;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetServerClockForTests();
    vi.setSystemTime(OPENS_AT - 60 * 60_000);
    runtimeFlagsMock.mockReturnValue(resolvedFlags());
  });

  afterEach(() => {
    useAuthStore.setState({ user: null });
    vi.useRealTimers();
  });

  it('keeps the CTA closed before the open for a scanner bundle account, like the API', () => {
    useAuthStore.setState({
      user: adminUser({
        adminCapabilityBundle: 'scanner',
        adminCapabilities: ['field.scan.read', 'field.scan.consume', 'field.scan.sync'],
      }),
    });

    const { result } = renderAvailability({ performanceStatus: 'selling', bookingStartsAt: OPENS_AT_ISO });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.bookingOpen).toBe(false);
    expect(result.current.isAdminBookingBypassActive).toBe(false);
  });

  it('keeps a restricted bundle account behind the sitewide booking gate', () => {
    runtimeFlagsMock.mockReturnValue(resolvedFlags({ bookingEnabled: false }));
    useAuthStore.setState({ user: adminUser({ adminCapabilityBundle: 'finance' }) });

    const { result } = renderAvailability({ performanceStatus: 'selling' });

    expect(result.current.bookingOpen).toBe(false);
    expect(result.current.isAdminBookingBypassActive).toBe(false);
  });

  it('lets a full admin bypass the queue before the open', () => {
    useAuthStore.setState({ user: adminUser() });

    const { result } = renderAvailability({ performanceStatus: 'selling', bookingStartsAt: OPENS_AT_ISO });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.bookingOpen).toBe(true);
    expect(result.current.isAdminBookingBypassActive).toBe(true);
  });

  it('treats a legacy admin without a bundle as a full admin, as the API does', () => {
    useAuthStore.setState({ user: adminUser({ adminCapabilityBundle: null, adminCapabilities: [] }) });

    const { result } = renderAvailability({ performanceStatus: 'selling', bookingStartsAt: OPENS_AT_ISO });

    expect(result.current.isAdminBookingBypassActive).toBe(true);
  });

  it('fails closed when the capability claims are missing', () => {
    useAuthStore.setState({
      user: adminUser({ adminCapabilityBundle: undefined, adminCapabilities: undefined }),
    });

    const { result } = renderAvailability({ performanceStatus: 'selling', bookingStartsAt: OPENS_AT_ISO });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.bookingOpen).toBe(false);
    expect(result.current.isAdminBookingBypassActive).toBe(false);
  });
});
