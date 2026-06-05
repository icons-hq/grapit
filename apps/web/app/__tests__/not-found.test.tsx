import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotFound from '../not-found';

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'ko'),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

describe('NotFoundPage', () => {
  it('Test 6: "페이지를 찾을 수 없습니다" 텍스트 렌더링', async () => {
    render(await NotFound());
    expect(screen.getByText('페이지를 찾을 수 없습니다')).toBeDefined();
  });

  it('Test 7: "( ._.)" 텍스트 페이스 렌더링', async () => {
    render(await NotFound());
    expect(screen.getByText('( ._.)')).toBeDefined();
  });

  it('Test 8: "홈으로 돌아가기" 링크가 href="/"를 가짐', async () => {
    render(await NotFound());
    const link = screen.getByText('홈으로 돌아가기');
    const anchor = link.closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('/');
  });

  it('Test 9: "요청하신 페이지가 존재하지 않거나 이동되었습니다." 텍스트 존재', async () => {
    render(await NotFound());
    expect(
      screen.getByText('요청하신 페이지가 존재하지 않거나 이동되었습니다.'),
    ).toBeDefined();
  });
});
