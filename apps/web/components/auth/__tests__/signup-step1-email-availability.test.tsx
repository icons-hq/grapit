import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { SignupStep1 } from '../signup-step1';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mocks.apiGet,
  },
}));

async function fillValidCredentials(email: string) {
  const user = userEvent.setup();

  await user.type(screen.getByLabelText(/이메일/), email);
  await user.type(screen.getByPlaceholderText('비밀번호를 입력해주세요'), 'Test1234!');
  await user.type(screen.getByPlaceholderText('비밀번호를 다시 입력해주세요'), 'Test1234!');

  return user;
}

describe('SignupStep1 email availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockResolvedValue({ available: true });
  });

  it('checks email availability automatically after a valid email blur and shows duplicate email error', async () => {
    mocks.apiGet.mockResolvedValueOnce({ available: false });
    render(<SignupStep1 onComplete={vi.fn()} defaultValues={null} />);
    const user = userEvent.setup();

    const emailInput = screen.getByLabelText(/이메일/);
    await user.type(emailInput, 'used@test.com');
    await user.tab();

    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith(
        '/api/v1/auth/email-availability?email=used%40test.com',
        { showErrorToast: false },
      );
      expect(screen.getByText('이미 사용 중인 이메일입니다')).toBeInTheDocument();
    });
  });

  it('checks availability before completing step 1 and blocks unavailable email', async () => {
    mocks.apiGet.mockResolvedValue({ available: false });
    const onComplete = vi.fn();
    render(<SignupStep1 onComplete={onComplete} defaultValues={null} />);

    const user = await fillValidCredentials('used@test.com');
    await user.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith(
        '/api/v1/auth/email-availability?email=used%40test.com',
        { showErrorToast: false },
      );
      expect(screen.getByText('이미 사용 중인 이메일입니다')).toBeInTheDocument();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('allows immediate submit after replacing a duplicate email with an available one', async () => {
    const onComplete = vi.fn();
    mocks.apiGet
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValueOnce({ available: true });
    render(<SignupStep1 onComplete={onComplete} defaultValues={null} />);

    const user = await fillValidCredentials('used@test.com');
    await user.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => {
      expect(screen.getByText('이미 사용 중인 이메일입니다')).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText(/이메일/));
    await user.type(screen.getByLabelText(/이메일/), 'new@test.com');
    await user.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        email: 'new@test.com',
        password: 'Test1234!',
        passwordConfirm: 'Test1234!',
      });
    });
  });

  it('does not render a required manual duplicate-check button', () => {
    render(<SignupStep1 onComplete={vi.fn()} defaultValues={null} />);

    expect(
      screen.queryByRole('button', { name: /중복|duplicate|check/i }),
    ).not.toBeInTheDocument();
  });
});
