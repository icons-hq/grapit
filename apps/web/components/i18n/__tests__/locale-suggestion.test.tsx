import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleSuggestion } from '../locale-suggestion';
import { useAuthStore } from '@/stores/use-auth-store';

const boundary = vi.hoisted(() => ({
  navigate: vi.fn(),
  push: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/performance/perf-1',
  useSearchParams: () => new URLSearchParams('tab=info'),
  useRouter: () => ({ push: boundary.push, replace: boundary.push }),
}));
vi.mock('@/lib/i18n/locale-navigation', () => ({ navigateToLocalizedPath: boundary.navigate }));
vi.mock('@/lib/api-client', () => ({ apiClient: { patch: boundary.patch } }));

function readCookie(name: string) {
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.split('=')[1];
}

describe('LocaleSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    window.sessionStorage.clear();
    document.cookie = 'preferred-locale=; Max-Age=0; path=/';
    document.cookie = 'locale-suggestion=th; path=/';
  });

  it('switches with a full navigation so the provider locale and html lang follow the URL', async () => {
    render(<LocaleSuggestion />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'ไทย' }));

    await waitFor(() => expect(boundary.navigate).toHaveBeenCalledWith('/th/performance/perf-1?tab=info'));
    expect(boundary.push).not.toHaveBeenCalled();
    expect(readCookie('preferred-locale')).toBe('th');
    expect(window.sessionStorage.getItem('locale-suggestion-dismissed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'ไทย' })).toBeNull();
  });

  it('stores the chosen language on the signed-in profile before navigating', async () => {
    const user = { id: 'user-1', preferredLocale: 'ko' };
    useAuthStore.setState({ accessToken: 'access-token', user } as never);
    boundary.patch.mockResolvedValue({ ...user, preferredLocale: 'th' });
    render(<LocaleSuggestion />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'ไทย' }));

    await waitFor(() => expect(boundary.navigate).toHaveBeenCalledWith('/th/performance/perf-1?tab=info'));
    expect(boundary.patch).toHaveBeenCalledWith('/api/v1/users/me', { preferredLocale: 'th' }, { showErrorToast: false });
    expect(boundary.patch.mock.invocationCallOrder[0]).toBeLessThan(boundary.navigate.mock.invocationCallOrder[0]!);
  });
});
