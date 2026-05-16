import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import ResetPasswordPage from '../page';

// --- next/navigation mock (hoisted so useSearchParams per-test can swap) ---
const mockSearchParams = { current: new URLSearchParams() };
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams.current,
  useRouter: () => ({ push: mockPush, replace: mockPush, refresh: vi.fn() }),
}));

// next/link mock (same pattern as not-found.test.tsx)
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// sonner toast mock — confirm success path uses toast.success
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// apiClient mock — catches regressions where request mode reintroduces global errors
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/frontend-origin', () => ({
  getFrontendOrigin: () => 'https://heygrabit.com',
}));

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mockSearchParams.current = new URLSearchParams();
    vi.clearAllMocks();
    mockPush.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('token query 없을 때 (request 모드)', () => {
    it('기존 이메일 입력 폼 텍스트가 렌더된다', () => {
      render(<ResetPasswordPage />);
      expect(screen.getByText('가입 시 사용한 이메일을 입력하세요')).toBeDefined();
      expect(screen.getByLabelText('이메일')).toBeDefined();
    });

    it('API 실패 응답이어도 toast.error 없이 성공 화면을 표시한다', async () => {
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.heygrabit.com');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: '메일 발송 실패' }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);
      const { apiClient } = await import('@/lib/api-client');

      render(<ResetPasswordPage />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('이메일'), 'member@example.com');
      await user.click(
        screen.getByRole('button', { name: '비밀번호 재설정 링크 발송' }),
      );

      await vi.waitFor(() => {
        expect(screen.getByText('비밀번호 재설정 메일 발송 완료')).toBeDefined();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.heygrabit.com/api/v1/auth/password-reset/request',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({
            email: 'member@example.com',
            frontendOrigin: 'https://heygrabit.com',
          }),
        }),
      );
      expect((apiClient.post as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('token query 있을 때 (confirm 모드)', () => {
    beforeEach(() => {
      mockSearchParams.current = new URLSearchParams('token=abc.def.ghi');
    });

    it('새 비밀번호 입력 UI가 렌더된다 (이메일 입력 폼이 아니다)', () => {
      render(<ResetPasswordPage />);
      expect(screen.queryByText('가입 시 사용한 이메일을 입력하세요')).toBeNull();
      const pwInputs = document.querySelectorAll(
        'input[autocomplete="new-password"]',
      );
      expect(pwInputs.length).toBe(2);
    });

    it('confirm 제출 성공 시 fetch 가 올바른 path + body 로 호출된다', async () => {
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.heygrabit.com');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: '비밀번호가 변경되었습니다' }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      render(<ResetPasswordPage />);
      const user = userEvent.setup();
      const pwInputs = document.querySelectorAll<HTMLInputElement>(
        'input[autocomplete="new-password"]',
      );
      await user.type(pwInputs[0], 'Test1234!');
      await user.type(pwInputs[1], 'Test1234!');
      await user.click(
        screen.getByRole('button', {
          name: /비밀번호 변경|변경하기|설정|확인/,
        }),
      );

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(
        'https://api.heygrabit.com/api/v1/auth/password-reset/confirm',
      );
      expect((init as RequestInit).method).toBe('POST');
      expect((init as RequestInit).credentials).toBe('include');
      expect((init as RequestInit).headers).toEqual({
        'Content-Type': 'application/json',
      });
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.token).toBe('abc.def.ghi');
      expect(body.newPassword).toBe('Test1234!');
      expect(body.newPasswordConfirm).toBe('Test1234!');
    });

    it('token query 변경 후 제출하면 최신 token을 사용한다', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: '비밀번호가 변경되었습니다' }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      const { rerender } = render(<ResetPasswordPage />);
      mockSearchParams.current = new URLSearchParams('token=new.token.value');
      rerender(<ResetPasswordPage />);

      const user = userEvent.setup();
      const pwInputs = document.querySelectorAll<HTMLInputElement>(
        'input[autocomplete="new-password"]',
      );
      await user.type(pwInputs[0], 'Test1234!');
      await user.type(pwInputs[1], 'Test1234!');
      await user.click(
        screen.getByRole('button', {
          name: /비밀번호 변경|변경하기|설정|확인/,
        }),
      );

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.token).toBe('new.token.value');
    });

    it('401 응답 시 에러 UI + "다시 요청하기" 링크가 표시된다', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: '유효하지 않은 재설정 토큰입니다' }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      render(<ResetPasswordPage />);
      const user = userEvent.setup();
      const pwInputs = document.querySelectorAll<HTMLInputElement>(
        'input[autocomplete="new-password"]',
      );
      await user.type(pwInputs[0], 'Test1234!');
      await user.type(pwInputs[1], 'Test1234!');
      await user.click(
        screen.getByRole('button', {
          name: /비밀번호 변경|변경하기|설정|확인/,
        }),
      );

      await vi.waitFor(() => {
        const matches = screen.queryAllByText(/유효하지 않은|만료|다시 요청/);
        expect(matches.length).toBeGreaterThan(0);
      });
      const retryLink = Array.from(document.querySelectorAll('a')).find(
        (a) => a.getAttribute('href') === '/auth/reset-password',
      );
      expect(retryLink).toBeDefined();
    });
  });
});
