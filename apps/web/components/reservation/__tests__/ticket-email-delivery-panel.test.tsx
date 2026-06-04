import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketEmailDeliveryPanel } from '@/components/reservation/ticket-email-delivery-panel';
import { useAuthStore } from '@/stores/use-auth-store';
import type { TicketEmailDelivery, UserProfile } from '@grabit/shared';

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: postMock,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return Wrapper;
}

function createUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-1',
    email: 'kakao_123@social.grabit.com',
    name: 'Customer',
    phone: '+821012345678',
    gender: 'unspecified',
    country: 'KR',
    birthDate: '1990-01-01',
    preferredLocale: 'ko',
    isEmailVerified: true,
    isPhoneVerified: true,
    marketingConsent: false,
    role: 'user',
    createdAt: '2026-05-06T00:00:00.000Z',
    ...overrides,
  };
}

function createDelivery(
  overrides: Partial<TicketEmailDelivery> = {},
): TicketEmailDelivery {
  return {
    email: 'customer@grabit.test',
    isEmailVerified: true,
    isPlaceholderEmail: false,
    canSend: true,
    status: 'ready',
    scheduledAt: '2026-07-03T10:00:00.000Z',
    lastSentAt: null,
    ...overrides,
  };
}

describe('TicketEmailDeliveryPanel', () => {
  beforeEach(() => {
    postMock.mockReset();
    useAuthStore.getState().clearAuth();
  });

  it('shows the send action when the account email can receive tickets', () => {
    render(
      <TicketEmailDeliveryPanel
        reservationId="reservation-1"
        delivery={createDelivery()}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('티켓 이메일')).toBeInTheDocument();
    expect(screen.getByText('customer@grabit.test')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '티켓 이메일 보내기' }),
    ).toBeInTheDocument();
  });

  it('verifies a real email and sends the ticket email for placeholder accounts', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth('access-token', createUser());
    postMock.mockImplementation((path: string) => {
      if (path === '/api/v1/auth/email-verification/account-email/request') {
        return Promise.resolve({
          message: '인증번호를 이메일로 발송했습니다',
          expiresAt: '2026-06-04T10:10:00.000Z',
        });
      }
      if (path === '/api/v1/auth/email-verification/account-email/verify') {
        return Promise.resolve({
          verified: true,
          user: createUser({
            email: 'real.customer@example.com',
            isEmailVerified: true,
          }),
        });
      }
      if (path === '/api/v1/tickets/reservations/reservation-1/email') {
        return Promise.resolve({
          ticketEmailDelivery: createDelivery({
            email: 'real.customer@example.com',
            status: 'sent',
            lastSentAt: '2026-06-04T10:00:00.000Z',
          }),
        });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });

    render(
      <TicketEmailDeliveryPanel
        reservationId="reservation-1"
        delivery={createDelivery({
          email: 'kakao_123@social.grabit.com',
          isPlaceholderEmail: true,
          canSend: false,
          status: 'verification_required',
          scheduledAt: null,
        })}
      />,
      { wrapper: createWrapper() },
    );

    await user.type(screen.getByLabelText('이메일'), 'real.customer@example.com');
    await user.click(screen.getByRole('button', { name: '인증번호 받기' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/auth/email-verification/account-email/request',
        { email: 'real.customer@example.com', locale: 'ko' },
      );
    });

    await user.type(screen.getByLabelText('인증번호'), '123456');
    await user.click(screen.getByRole('button', { name: '인증하고 티켓 받기' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/auth/email-verification/account-email/verify',
        { email: 'real.customer@example.com', code: '123456' },
      );
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/tickets/reservations/reservation-1/email',
      );
    });
    expect(useAuthStore.getState().user?.email).toBe('real.customer@example.com');
    expect(screen.getByText('real.customer@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '티켓 이메일 다시 보내기' }),
    ).toBeInTheDocument();
  });
});
