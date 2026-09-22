import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCapability } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { AdminSidebar } from '../admin-sidebar';
import { SeatOperationsPanel } from '../seat-operations-panel';
import { AdminEventContextBar, AdminEventContextProvider } from '../admin-event-context';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/seat-operations', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/hooks/use-admin', () => ({ useAdminPerformanceDetail: () => ({ data: null }), useAdminPerformances: () => ({ data: { data: [] } }) }));
vi.mock('@/hooks/use-admin-seat-operations', () => ({
  useAdminSeatOperationHistory: () => ({ data: { rows: [] } }),
  useDisableAdminSeat: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useReactivateAdminSeat: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
function setCapabilities(capabilities: AdminCapability[]) {
  useAuthStore.getState().setAuth('test-only', { id: 'custom-seat-operator', email: 'operator@example.test', name: 'Operator',
    phone: '+82100000000', gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
    isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'admin', adminCapabilityBundle: null,
    adminCapabilities: capabilities, createdAt: '2026-01-01T00:00:00Z' });
}
describe('Seat operation custom capabilities', () => {
  beforeEach(() => setCapabilities([]));
  it.each<AdminCapability>(['seat.disable', 'seat.reactivate', 'seat.manual_open'])('shows the seat menu for %s', (capability) => {
    setCapabilities([capability]);
    render(<AdminSidebar />);
    expect(screen.getByRole('link', { name: '좌석 운영' })).toBeInTheDocument();
  });
  it.each<AdminCapability>(['seat.disable', 'seat.reactivate', 'seat.manual_open'])('offers only permitted actions for %s', (capability) => {
    setCapabilities([capability]);
    render(<SeatOperationsPanel initialShowtimeId="showtime" initialSeatKey="1F:A-1" />);
    expect(Boolean(screen.queryByRole('button', { name: '좌석 비활성화' }))).toBe(capability === 'seat.disable');
    expect(Boolean(screen.queryByRole('button', { name: '좌석 재활성화' }))).toBe(capability === 'seat.reactivate');
  });
  it.each<AdminCapability>(['seat.disable', 'seat.reactivate', 'seat.manual_open'])('shows the event-context seat link for %s', (capability) => {
    setCapabilities([capability]);
    render(<AdminEventContextProvider><AdminEventContextBar /></AdminEventContextProvider>);
    expect(screen.getByRole('link', { name: '좌석' })).toBeInTheDocument();
  });
});
