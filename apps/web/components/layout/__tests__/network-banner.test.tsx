import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkBanner } from '../network-banner';

const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

describe('NetworkBanner', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    'onLine',
  );

  function setOnLine(value: boolean) {
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => value,
    });
  }

  afterEach(() => {
    navigation.pathname = '/';
    if (originalOnLine) {
      Object.defineProperty(Navigator.prototype, 'onLine', originalOnLine);
    }
  });

  it('Test 1: navigator.onLine=false일 때 "인터넷 연결을 확인해주세요" 텍스트 렌더링', () => {
    setOnLine(false);
    render(<NetworkBanner />);
    expect(screen.getByText('인터넷 연결을 확인해주세요')).toBeDefined();
  });

  it('Test 2: navigator.onLine=true일 때 렌더링되지 않음', () => {
    setOnLine(true);
    const { container } = render(<NetworkBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('Test 3: "다시 시도" 버튼이 존재함', () => {
    setOnLine(false);
    render(<NetworkBanner />);
    expect(screen.getByText('다시 시도')).toBeDefined();
  });

  it('Test 4: role="alert" 속성이 존재함', () => {
    setOnLine(false);
    render(<NetworkBanner />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('Test 5: aria-live="assertive" 속성이 존재함', () => {
    setOnLine(false);
    render(<NetworkBanner />);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  // The banner covered the scanner's 검표 종료 button, and its reload lost the
  // results verified before the connection dropped (field-ops-6).
  it.each(['/field/check-in', '/field', '/en/field/check-in'])(
    'stays hidden on the field screen %s while offline',
    (pathname) => {
      navigation.pathname = pathname;
      setOnLine(false);
      const { container } = render(<NetworkBanner />);
      expect(container.innerHTML).toBe('');
    },
  );

  it.each(['/', '/fieldtrip', '/en/performance/1'])('still shows with its reload button on %s while offline', (pathname) => {
    navigation.pathname = pathname;
    setOnLine(false);
    render(<NetworkBanner />);
    expect(screen.getByRole('alert').textContent).toContain('다시 시도');
  });
});
