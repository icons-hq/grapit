import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Footer } from '../footer';

const localeMock = vi.hoisted(() => ({
  activeLocale: 'ko',
}));

vi.mock('next-intl', () => ({
  useLocale: () => localeMock.activeLocale,
}));

describe('Footer (D-03, D-04)', () => {
  beforeEach(() => {
    localeMock.activeLocale = 'ko';
  });

  describe('링크 href 계약 (D-03)', () => {
    it('이용약관 링크가 /legal/terms 로 연결된다', () => {
      render(<Footer />);
      const link = screen.getByText('이용약관').closest('a');
      expect(link?.getAttribute('href')).toBe('/legal/terms');
    });

    it('개인정보처리방침 링크가 /legal/privacy 로 연결되며 font-semibold 강조를 유지한다 (정통망법)', () => {
      render(<Footer />);
      const link = screen.getByText('개인정보처리방침').closest('a');
      expect(link?.getAttribute('href')).toBe('/legal/privacy');
      expect(link?.className).toContain('font-semibold');
    });

    it('고객센터 링크가 mailto:support@heygrabit.com 으로 변경된다', () => {
      render(<Footer />);
      const link = screen.getByText('고객센터').closest('a');
      expect(link?.getAttribute('href')).toBe('mailto:support@heygrabit.com');
    });

    it('고객센터 링크에 target/rel 이 부착되지 않는다 (mailto 는 새 탭 의미 없음)', () => {
      render(<Footer />);
      const link = screen.getByText('고객센터').closest('a');
      expect(link?.getAttribute('target')).toBeNull();
      expect(link?.getAttribute('rel')).toBeNull();
    });
  });

  describe('마케팅 수신 동의 미노출 (D-04 회귀 가드)', () => {
    it('Footer 에 /legal/marketing 링크가 등장하지 않는다', () => {
      const { container } = render(<Footer />);
      expect(container.innerHTML).not.toContain('/legal/marketing');
    });

    it('Footer 에 "마케팅" 텍스트가 등장하지 않는다', () => {
      render(<Footer />);
      expect(screen.queryByText(/마케팅/)).toBeNull();
    });
  });

  describe('런칭 compliance surface', () => {
    it('사업자 식별정보와 운영 연락처를 노출한다', () => {
      render(<Footer />);

      expect(screen.getByText(/사업자명: \(주\)아이콘스/)).toBeInTheDocument();
      expect(screen.getByText(/대표자: 정승준/)).toBeInTheDocument();
      expect(screen.getByText(/사업자등록번호: 109-86-27576/)).toBeInTheDocument();
      expect(screen.getByText(/통신판매업 신고번호: 2025-서울마포-1494/)).toBeInTheDocument();
      expect(screen.getByText('고객센터: 02-325-1794')).toBeInTheDocument();
      expect(screen.getByText(/개인정보 보호책임자: 정승준/)).toBeInTheDocument();
    });

    it('개인정보 문의 링크가 DPO mailbox 로 연결된다', () => {
      render(<Footer />);

      const link = screen.getByText('privacy@heygrabit.com').closest('a');
      expect(link?.getAttribute('href')).toBe('mailto:privacy@heygrabit.com');
    });

    it('LINE 또는 social login 링크를 전역 footer 에 추가하지 않는다', () => {
      render(<Footer />);

      expect(screen.queryByRole('link', { name: /line/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /social/i })).not.toBeInTheDocument();
    });
  });

  describe('변경 금지 영역 (UI-SPEC §Layout Contract)', () => {
    it('Copyright 라인이 변경되지 않는다', () => {
      render(<Footer />);
      expect(screen.getByText(/© 2026 Grabit\. All rights reserved\./)).not.toBeNull();
    });
  });

  describe('public i18n surface', () => {
    it('영어 locale 에서는 footer 링크와 사업자 label 을 영어로 렌더링한다', () => {
      localeMock.activeLocale = 'en';
      render(<Footer />);

      expect(screen.getByText('Terms of Service').closest('a')).toHaveAttribute(
        'href',
        '/en/legal/terms',
      );
      expect(screen.getByText('Privacy Policy').closest('a')).toHaveAttribute(
        'href',
        '/en/legal/privacy',
      );
      expect(screen.getByText(/Company: ICONS Co\., Ltd\./)).toBeInTheDocument();
      expect(screen.queryByText(/사업자명:/)).not.toBeInTheDocument();
    });
  });
});
