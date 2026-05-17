import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { ReservationListItem, UserProfile } from '@grabit/shared';

import MyPage from '../page';

type AccountHubUser = UserProfile & {
  marketingConsent?: boolean | null;
};

const mocks = vi.hoisted(() => ({
  search: '',
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
  user: {
    id: 'user-1',
    email: 'fan@example.com',
    name: 'Fan User',
    phone: '+821012345678',
    gender: 'unspecified',
    country: 'KR',
    birthDate: '1998-05-17',
    preferredLocale: 'en',
    isEmailVerified: true,
    isPhoneVerified: true,
    role: 'user',
    marketingConsent: true,
    createdAt: '2026-05-01T00:00:00.000Z',
  } as AccountHubUser,
  reservations: [
    {
      id: 'reservation-1',
      reservationNumber: 'R-001',
      status: 'CONFIRMED',
      performanceTitle: 'Seoul Spring Concert',
      posterUrl: null,
      showDateTime: '2026-06-10T10:00:00.000Z',
      venue: 'Olympic Hall',
      seats: [
        {
          seatId: 'seat-1',
          floorKey: '1f',
          floorLabel: '1층',
          seatKey: 'A-1',
          tierName: 'VIP',
          price: 120000,
          row: 'A',
          number: '1',
        },
      ],
      totalAmount: 120000,
      createdAt: '2026-05-10T00:00:00.000Z',
    },
    {
      id: 'reservation-2',
      reservationNumber: 'R-002',
      status: 'CANCELLED',
      performanceTitle: 'Refunded Match',
      posterUrl: null,
      showDateTime: '2026-05-20T10:00:00.000Z',
      venue: 'Main Stadium',
      seats: [],
      totalAmount: 80000,
      createdAt: '2026-05-11T00:00:00.000Z',
    },
    {
      id: 'reservation-3',
      reservationNumber: 'R-003',
      status: 'PENDING_PAYMENT',
      performanceTitle: 'Pending Exhibition',
      posterUrl: null,
      showDateTime: '2026-07-01T10:00:00.000Z',
      venue: 'Art Center',
      seats: [],
      totalAmount: 30000,
      createdAt: '2026-05-12T00:00:00.000Z',
    },
  ] as ReservationListItem[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.routerReplace,
    push: mocks.routerPush,
  }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('next/image', () => ({
  default: (props: { alt: string; src?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={props.alt} src={props.src} />
  ),
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: (
    selector?: (state: {
      user: AccountHubUser;
      accessToken: string;
      isInitialized: boolean;
      clearAuth: () => void;
      setAuth: () => void;
    }) => unknown,
  ) => {
    const state = {
      user: mocks.user,
      accessToken: 'access-token',
      isInitialized: true,
      clearAuth: vi.fn(),
      setAuth: vi.fn(),
    };

    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/hooks/use-reservations', () => ({
  useMyReservations: () => ({
    data: mocks.reservations,
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock('@/components/auth/profile-form', () => ({
  ProfileForm: () => <div>profile form core</div>,
}));

describe('MyPage account hub', () => {
  beforeEach(() => {
    mocks.search = '';
    vi.clearAllMocks();
  });

  it('renders account, ticket wallet, and settings as first-class mobile tabs', () => {
    render(<MyPage />);

    expect(screen.getByRole('tab', { name: /계정/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /티켓 지갑/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /설정/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '계정 개요' })).toBeInTheDocument();
    expect(screen.getByText('fan@example.com')).toBeInTheDocument();
    expect(screen.getByText('South Korea')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('동의')).toBeInTheDocument();
  });

  it('shows reservation, ticket, and refund status before the full reservation list', () => {
    mocks.search = 'tab=wallet';

    render(<MyPage />);

    expect(screen.getByRole('heading', { name: '티켓 지갑' })).toBeInTheDocument();
    expect(screen.getAllByText('결제대기').length).toBeGreaterThan(0);
    expect(screen.getAllByText('취소/환불').length).toBeGreaterThan(0);
    expect(screen.getByText('Seoul Spring Concert')).toBeInTheDocument();
    expect(screen.getByText('Refunded Match')).toBeInTheDocument();
  });

  it('keeps the legacy reservations query tab on the ticket wallet surface', () => {
    mocks.search = 'tab=reservations';

    render(<MyPage />);

    expect(screen.getByRole('heading', { name: '티켓 지갑' })).toBeInTheDocument();
  });

  it('routes quick actions to wallet and settings tabs', async () => {
    const user = userEvent.setup();
    render(<MyPage />);

    await user.click(screen.getByRole('button', { name: /티켓 지갑 보기/ }));
    expect(mocks.routerReplace).toHaveBeenCalledWith('/mypage?tab=wallet');

    await user.click(screen.getByRole('button', { name: /설정 변경/ }));
    expect(mocks.routerReplace).toHaveBeenCalledWith('/mypage?tab=settings');
  });

  it('keeps ProfileForm as the settings core', () => {
    mocks.search = 'tab=settings';

    render(<MyPage />);

    expect(screen.getByRole('heading', { name: '설정 센터' })).toBeInTheDocument();
    expect(screen.getByText('profile form core')).toBeInTheDocument();
  });
});
