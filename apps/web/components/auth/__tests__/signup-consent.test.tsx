import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { LoginForm } from '../login-form';
import { SignupStep2 } from '../signup-step2';

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams(),
  activeLocale: 'ko',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationMocks.push }),
  useSearchParams: () => navigationMocks.searchParams,
}));

vi.mock('next-intl', () => ({
  useLocale: () => navigationMocks.activeLocale,
}));

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

vi.mock('@/content/legal/terms-of-service.md', () => ({
  default: '# 이용약관\n\n약관 본문',
}));

vi.mock('@/content/legal/privacy-policy.md', () => ({
  default: '# 개인정보처리방침\n\n개인정보 본문',
}));

vi.mock('@/content/legal/marketing-consent.md', () => ({
  default: '# 마케팅 수신 동의\n\n마케팅 본문',
}));

describe('SignupStep2 itemized launch consent', () => {
  beforeEach(() => {
    navigationMocks.activeLocale = 'ko';
  });

  it('renders required and optional itemized consent rows with version, language, and legal dialog actions', async () => {
    render(
      <SignupStep2
        onComplete={vi.fn()}
        onBack={vi.fn()}
        defaultValues={null}
      />,
    );

    const requiredRows = [
      '이용약관 동의',
      '개인정보처리방침 동의',
      '개인정보 필수 수집 및 이용 동의',
    ];

    for (const row of requiredRows) {
      expect(screen.getByLabelText(new RegExp(row))).toBeInTheDocument();
    }

    expect(screen.getByLabelText(/마케팅 수신 동의/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/개인정보 국외이전 동의/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/태국 PDPA 고지 확인/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/중국 PIPL 고지 확인/)).not.toBeInTheDocument();
    expect(screen.getAllByText('필수')).toHaveLength(requiredRows.length);
    expect(screen.getByText('선택')).toBeInTheDocument();
    expect(screen.getAllByText(/v2026-04-28/)).toHaveLength(4);
    expect(screen.getAllByText(/ko/)).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: '보기' })).toHaveLength(4);

    await userEvent.click(screen.getAllByRole('button', { name: '보기' })[2]!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent('개인정보 필수 수집 및 이용');
    });
  });

  it('blocks progression when required privacy collection consent is refused', async () => {
    const onComplete = vi.fn();
    render(
      <SignupStep2
        onComplete={onComplete}
        onBack={vi.fn()}
        defaultValues={null}
      />,
    );

    const user = userEvent.setup();
    for (const label of [
      /이용약관 동의/,
      /개인정보처리방침 동의/,
    ]) {
      await user.click(screen.getByLabelText(label));
    }

    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('returns consent item rows with key, version, language, accepted/refused, required status, and signup source flow', async () => {
    const onComplete = vi.fn();
    render(
      <SignupStep2
        onComplete={onComplete}
        onBack={vi.fn()}
        defaultValues={null}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/전체 동의/));
    await user.click(screen.getByLabelText(/마케팅 수신 동의/));
    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        termsOfService: true,
        privacyPolicy: true,
        marketingConsent: false,
        consentItems: expect.arrayContaining([
          expect.objectContaining({
            key: 'pipa_required',
            version: '2026-04-28',
            language: 'ko',
            accepted: true,
            required: true,
            sourceFlow: 'signup',
          }),
          expect.objectContaining({
            key: 'marketing',
            version: '2026-04-28',
            language: 'ko',
            accepted: false,
            required: false,
            sourceFlow: 'signup',
          }),
        ]),
      }),
    );
    expect(
      onComplete.mock.calls[0]?.[0].consentItems.map(
        (item: { key: string }) => item.key,
      ),
    ).toEqual([
      'terms',
      'privacy',
      'pipa_required',
      'marketing',
    ]);
  });

  it('shows the final under-14 block copy without a guardian consent flow', () => {
    render(
      <SignupStep2
        onComplete={vi.fn()}
        onBack={vi.fn()}
        defaultValues={null}
      />,
    );

    expect(screen.getByText('만 14세 미만은 가입할 수 없습니다')).toBeInTheDocument();
    expect(screen.queryByText(/보호자|법정대리인|guardian/i)).not.toBeInTheDocument();
  });

  it('renders consent labels and captures consent language from the active locale', async () => {
    navigationMocks.activeLocale = 'en';
    const onComplete = vi.fn();

    render(
      <SignupStep2
        onComplete={onComplete}
        onBack={vi.fn()}
        defaultValues={null}
      />,
    );

    const user = userEvent.setup();
    expect(screen.getByLabelText(/Agree to Terms of Service/)).toBeInTheDocument();
    expect(screen.getAllByText('Required')).toHaveLength(3);
    expect(screen.getByText('Optional')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Agree to all/));
    await user.click(screen.getByLabelText(/Agree to receive marketing messages/));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        consentItems: expect.arrayContaining([
          expect.objectContaining({
            key: 'terms',
            language: 'en',
            sourceFlow: 'signup',
          }),
        ]),
      }),
    );
  });
});

describe('auth provider launch surface', () => {
  it('keeps Kakao, Naver, Google, and email login visible while LINE is absent', () => {
    navigationMocks.activeLocale = 'ko';
    render(<LoginForm />);

    expect(screen.getByLabelText(/이메일/)).toBeInTheDocument();
    expect(screen.getByText('카카오로 시작하기')).toBeInTheDocument();
    expect(screen.getByText('네이버로 시작하기')).toBeInTheDocument();
    expect(screen.getByText('Google로 시작하기')).toBeInTheDocument();
    expect(screen.queryByText(/\bLINE\b|\bLine\b|라인/)).not.toBeInTheDocument(); // D-13 absent
  });

  it('localizes social login buttons for English auth routes', () => {
    navigationMocks.activeLocale = 'en';
    render(<LoginForm />);

    expect(screen.getByText('Continue with Kakao')).toBeInTheDocument();
    expect(screen.getByText('Continue with Naver')).toBeInTheDocument();
    expect(screen.getByText('Continue with Google')).toBeInTheDocument();
    expect(screen.queryByText('카카오로 시작하기')).not.toBeInTheDocument();
  });
});
