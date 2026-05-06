import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { PhoneVerification } from '../phone-verification';

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

// API client mock
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
    }
  },
}));

// react-phone-number-input + shadcn PhoneInput이 E.164 라이브러리와 shadcn
// Popover/Command 블록을 소유하므로 더 이상 detectPhoneLocale mock이 필요하지 않다.

describe('PhoneVerification', () => {
  // KR 기본 상태에서 "인증번호 발송" 버튼이 활성이 되도록 E.164 포맷의 한국 번호를
  // 초기 값으로 지정한다. react-phone-number-input은 E.164 문자열을 value로 기대한다.
  const defaultProps = {
    phone: '+821012345678',
    onPhoneChange: vi.fn(),
    onVerified: vi.fn(),
    isVerified: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------- 초기 상태 ----------
  describe('초기 상태', () => {
    it('"인증번호 발송" 버튼이 존재', () => {
      render(<PhoneVerification {...defaultProps} />);
      expect(screen.getByRole('button', { name: /인증번호 발송/ })).toBeInTheDocument();
    });

    it('인증번호 입력 필드가 숨겨져 있음', () => {
      render(<PhoneVerification {...defaultProps} />);
      expect(screen.queryByPlaceholderText(/인증번호 6자리/)).not.toBeInTheDocument();
    });
  });

  // ---------- 발송 후 상태 ----------
  describe('발송 후', () => {
    it('SMS OTP sent state is announced with localized copy', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('인증번호가 발송되었습니다');
      });
    });

    it('"인증번호 6자리" 입력 필드가 노출', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/인증번호 6자리/)).toBeInTheDocument();
      });
    });

    it('30초 쿨다운 라벨 "재발송 (Ns)" 표시', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));
      await waitFor(() => {
        // 쿨다운 버튼에 "재발송 (30s)" 또는 유사한 카운트다운 라벨이 포함
        expect(screen.getByText(/재발송.*\d+s/)).toBeInTheDocument();
      });
    });
  });

  // ---------- 쿨다운 종료 ----------
  describe('쿨다운 종료', () => {
    it('"재발송" 버튼이 활성화(outline variant)', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      // 쿨다운 카운트다운이 시작된 뒤에 timer를 advance해야 한다.
      // user.click은 dispatch까지만 await하므로 handleSendCode의 setResendCooldown(30)이
      // 아직 commit되지 않은 상태에서 advanceTimersByTime을 호출하면 setInterval이
      // 존재하지 않아 advance가 무의미해진다 (CI에서 100% 실패하는 race condition).
      await waitFor(() => {
        expect(screen.getByText(/재발송 \(30s\)/)).toBeInTheDocument();
      });

      // 30초 경과
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /재발송/ });
        expect(btn).not.toBeDisabled();
      });
    });

    it('SMS OTP resend loading and success states use localized copy', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));
      await waitFor(() => {
        expect(screen.getByText(/재발송 \(30s\)/)).toBeInTheDocument();
      });

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      let resolveResend!: () => void;
      (apiClient.post as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveResend = () => resolve({ success: true });
        }),
      );

      await user.click(screen.getByRole('button', { name: /인증번호 재발송/ }));
      expect(screen.getByText('인증번호를 다시 보내는 중입니다')).toBeInTheDocument();

      resolveResend();

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('인증번호를 다시 보냈습니다');
      });
    });
  });

  // ---------- 에러 카피 ----------
  describe('에러 카피', () => {
    it('429 에러 시 "잠시 후 다시 시도해주세요"', async () => {
      const { apiClient, ApiClientError } = await import('@/lib/api-client');
      const error429 = new ApiClientError('잠시 후 다시 시도해주세요', 429);
      (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error429);

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByText(/잠시 후 다시 시도해주세요/)).toBeInTheDocument();
      });
    });

    it('410 에러 시 "인증번호가 만료되었습니다. 재발송해주세요"', async () => {
      const { apiClient, ApiClientError } = await import('@/lib/api-client');
      // 발송 먼저 성공
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      // verify에서 410 에러
      const error410 = new ApiClientError('인증번호가 만료되었습니다. 재발송해주세요', 410);
      (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error410);

      await waitFor(() => {
        const input = screen.getByPlaceholderText(/인증번호 6자리/);
        expect(input).toBeInTheDocument();
      });

      const codeInput = screen.getByPlaceholderText(/인증번호 6자리/);
      await user.type(codeInput, '123456');
      await user.click(screen.getByRole('button', { name: /확인/ }));

      await waitFor(() => {
        expect(screen.getByText(/인증번호가 만료되었습니다/)).toBeInTheDocument();
      });
    });

    it('400 에러 시 "인증번호가 일치하지 않습니다"', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      // verify에서 400
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        verified: false,
        message: '인증번호가 일치하지 않습니다',
      });

      await waitFor(() => {
        const input = screen.getByPlaceholderText(/인증번호 6자리/);
        expect(input).toBeInTheDocument();
      });

      const codeInput = screen.getByPlaceholderText(/인증번호 6자리/);
      await user.type(codeInput, '999999');
      await user.click(screen.getByRole('button', { name: /확인/ }));

      await waitFor(() => {
        expect(screen.getByText(/인증번호가 일치하지 않습니다/)).toBeInTheDocument();
      });
    });

    it('500 에러 시 system error copy를 표시하고 raw provider message는 숨김', async () => {
      const { apiClient, ApiClientError } = await import('@/lib/api-client');
      const err = new ApiClientError('raw infobip outage', 500);
      (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          '인증번호 처리에 실패했습니다. 잠시 후 다시 시도해주세요',
        );
        expect(screen.queryByText('raw infobip outage')).not.toBeInTheDocument();
      });
    });
  });

  // ---------- 국가 선택 드롭다운 ----------
  describe('국가 선택 드롭다운', () => {
    it('국가 셀렉터 버튼이 렌더링되어 "인증번호 발송" 버튼과 함께 존재', () => {
      render(<PhoneVerification {...defaultProps} phone="" />);
      // PhoneInput이 Popover Trigger 버튼을 포함하므로 전체 버튼 수는 2개 이상
      expect(screen.getAllByRole('button').length).toBeGreaterThan(1);
    });

    it('자동 감지 안내 텍스트 ("...번호로 SMS를 발송합니다")는 더 이상 표시되지 않음', () => {
      render(<PhoneVerification {...defaultProps} phone="+66812345678" />);
      expect(
        screen.queryByText(/번호로 SMS를 발송합니다/),
      ).not.toBeInTheDocument();
    });

    it('KR 기본 상태에서 inner input이 placeholder "010-0000-0000"을 노출 (E2E 선택자 호환성)', () => {
      render(<PhoneVerification {...defaultProps} phone="" />);
      // E2E: page.getByPlaceholder('010-0000-0000')와 호환되도록 placeholder
      // prop이 react-phone-number-input inputComponent까지 spread 전달되어야 함
      expect(
        screen.getByPlaceholderText('010-0000-0000'),
      ).toBeInTheDocument();
    });
  });

  // ---------- 시도 횟수 미노출 (D-19) ----------
  describe('시도 횟수 미노출', () => {
    it('"남은 시도" 문구가 없음 (D-19)', () => {
      render(<PhoneVerification {...defaultProps} />);
      expect(screen.queryByText(/남은 시도/)).not.toBeInTheDocument();
    });
  });

  // ---------- 접근성 ----------
  describe('접근성', () => {
    it('autoComplete="one-time-code" 존재', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        const input = screen.getByPlaceholderText(/인증번호 6자리/);
        expect(input).toHaveAttribute('autocomplete', 'one-time-code');
      });
    });

    it('쿨다운 상태에서 aria-label="재발송 대기 중" 존재', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByLabelText(/재발송 대기 중/)).toBeInTheDocument();
      });
    });

    it('에러 메시지에 role="alert" 존재', async () => {
      const { apiClient, ApiClientError } = await import('@/lib/api-client');
      const err = new ApiClientError('잠시 후 다시 시도해주세요', 429);
      (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
      });
    });
  });

  // ---------- D-07 server message priority ----------
  describe('서버 message 우선 (D-07)', () => {
    it('SC-4a: verified=false + message 존재 → 서버 메시지 표시', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({
          verified: false,
          message: '인증번호 확인에 실패했습니다. 잠시 후 다시 시도해주세요.',
        });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/인증번호 6자리/)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/인증번호 6자리/), '123456');
      await user.click(screen.getByRole('button', { name: /확인/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          '인증번호 확인에 실패했습니다. 잠시 후 다시 시도해주세요.',
        );
      });
    });

    it('SC-4b-1: verified=false + message undefined → 하드코드 fallback', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ verified: false }); // message undefined

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/인증번호 6자리/)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/인증번호 6자리/), '999999');
      await user.click(screen.getByRole('button', { name: /확인/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('인증번호가 일치하지 않습니다');
      });
    });

    it('SC-4b-2: verified=false + message 빈 문자열 → 하드코드 fallback (D-08)', async () => {
      const { apiClient } = await import('@/lib/api-client');
      (apiClient.post as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ verified: false, message: '' });

      render(<PhoneVerification {...defaultProps} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/인증번호 6자리/)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/인증번호 6자리/), '999999');
      await user.click(screen.getByRole('button', { name: /확인/ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('인증번호가 일치하지 않습니다');
      });
    });

    it('SC-4c: verified=true → onVerified 호출 + alert 미표시 (회귀 가드)', async () => {
      const { apiClient } = await import('@/lib/api-client');
      const onVerified = vi.fn();
      (apiClient.post as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ verified: true });

      render(<PhoneVerification {...defaultProps} onVerified={onVerified} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /인증번호 발송/ }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/인증번호 6자리/)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/인증번호 6자리/), '123456');
      await user.click(screen.getByRole('button', { name: /확인/ }));

      await waitFor(() => {
        expect(onVerified).toHaveBeenCalledWith('123456');
      });
      // 성공 분기에서는 에러 alert 가 없어야 함 (D-07 regression guard)
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
