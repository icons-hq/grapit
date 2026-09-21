import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleSwitcher } from '../locale-switcher';
import { useAuthStore } from '@/stores/use-auth-store';
const boundary = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/auth',
  useSearchParams: () => new URLSearchParams('returnTo=%2Fen%2Fbooking%2Fshow%2Fconfirm%3FresumeOrderId%3Doriginal&verified=1'),
}));
vi.mock('@/lib/i18n/locale-navigation', () => ({ navigateToLocalizedPath: boundary.navigate }));
beforeEach(() => { vi.clearAllMocks(); useAuthStore.getState().clearAuth(); });
it('changes the pending booking language when the buyer changes the login language', async () => {
  const user = userEvent.setup();
  render(<LocaleSwitcher />);
  await user.click(screen.getByRole('button', { name: /Language/ }));
  await user.click(screen.getByRole('menuitem', { name: /ไทย/ }));
  await waitFor(() => expect(boundary.navigate).toHaveBeenCalled());
  const destination = new URL(boundary.navigate.mock.calls[0]![0], 'http://localhost');
  expect(destination.pathname).toBe('/th/auth');
  expect(destination.searchParams.get('returnTo')).toBe('/th/booking/show/confirm?resumeOrderId=original');
  expect(destination.searchParams.get('verified')).toBe('1');
});
