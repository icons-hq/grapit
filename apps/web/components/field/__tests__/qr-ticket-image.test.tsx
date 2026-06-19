import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrTicketImage } from '../qr-ticket-image';

const rawToken = 'raw-token-phase27-should-not-render';
const rawJTI = 'raw-JTI-phase27-should-not-render';
const qrCheckInUrl = `https://heygrabit.com/field/check-in?ticket=${rawToken}&jti=${rawJTI}`;

function renderQrTicketImage() {
  render(<QrTicketImage value={qrCheckInUrl} />);
}

describe('QrTicketImage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the configured HTTPS public web origin before the browser origin for check-in QR URLs', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN', 'https://field-rehearsal.example.com');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://browser-origin.example.com',
      },
    });

    const { buildQrCheckInUrl } = await import('../qr-ticket-image');

    expect(buildQrCheckInUrl('token')).toBe(
      'https://field-rehearsal.example.com/field/check-in?ticket=token',
    );
  });

  it('ignores configured origins that include path components', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN', 'https://field-rehearsal.example.com/check-in');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://browser-origin.example.com',
      },
    });

    const { buildQrCheckInUrl } = await import('../qr-ticket-image');

    expect(buildQrCheckInUrl('token')).toBe(
      'https://browser-origin.example.com/field/check-in?ticket=token',
    );
  });

  it('ignores configured origins that include userinfo', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN', 'https://user@example.com');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://browser-origin.example.com',
      },
    });

    const { buildQrCheckInUrl } = await import('../qr-ticket-image');

    expect(buildQrCheckInUrl('token')).toBe(
      'https://browser-origin.example.com/field/check-in?ticket=token',
    );
  });

  it('ignores malformed configured origin values', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN', 'not a url');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://browser-origin.example.com',
      },
    });

    const { buildQrCheckInUrl } = await import('../qr-ticket-image');

    expect(buildQrCheckInUrl('token')).toBe(
      'https://browser-origin.example.com/field/check-in?ticket=token',
    );
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.1.27:3000',
  ])('allows configured non-production HTTP rehearsal origin %s', async (origin) => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN', origin);
    vi.stubGlobal('window', {
      location: {
        origin: 'http://browser-origin.example.com',
      },
    });

    const { buildQrCheckInUrl, QrTicketImage: RehearsalQrTicketImage } = await import(
      '../qr-ticket-image'
    );
    const qrUrl = buildQrCheckInUrl('token');

    expect(qrUrl).toBe(`${origin}/field/check-in?ticket=token`);

    render(<RehearsalQrTicketImage value={qrUrl} />);

    expect(screen.getByTestId('qr-ticket-image')).toHaveAttribute('data-qr-url', qrUrl);
  });

  it('uses the current non-production browser HTTP origin instead of production fallback', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:3000',
      },
    });

    const { buildQrCheckInUrl, QrTicketImage: BrowserQrTicketImage } = await import(
      '../qr-ticket-image'
    );
    const qrUrl = buildQrCheckInUrl('token');

    expect(qrUrl).toBe('http://127.0.0.1:3000/field/check-in?ticket=token');

    render(<BrowserQrTicketImage value={qrUrl} />);

    expect(screen.getByTestId('qr-ticket-image')).toHaveAttribute('data-qr-url', qrUrl);
  });

  it('uses the current local browser HTTP origin when a local build runs with production NODE_ENV', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:3000',
      },
    });

    const { buildQrCheckInUrl, QrTicketImage: LocalProductionQrTicketImage } = await import(
      '../qr-ticket-image'
    );
    const qrUrl = buildQrCheckInUrl('token');

    expect(qrUrl).toBe('http://127.0.0.1:3000/field/check-in?ticket=token');

    render(<LocalProductionQrTicketImage value={qrUrl} />);

    expect(screen.getByTestId('qr-ticket-image')).toHaveAttribute('data-qr-url', qrUrl);
  });

  it('uses documented localhost rehearsal origin in non-production without browser origin', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');

    const { buildQrCheckInUrl, QrTicketImage: LocalQrTicketImage } = await import(
      '../qr-ticket-image'
    );
    const qrUrl = buildQrCheckInUrl('token');

    expect(qrUrl).toBe('http://localhost:3000/field/check-in?ticket=token');

    render(<LocalQrTicketImage value={qrUrl} />);

    expect(screen.getByTestId('qr-ticket-image')).toHaveAttribute('data-qr-url', qrUrl);
  });

  it('ignores configured HTTP origins in production and keeps the render guard HTTPS-only', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN', 'http://localhost:3000');
    vi.stubGlobal('window', {
      location: {
        origin: 'https://browser-origin.example.com',
      },
    });

    const { buildQrCheckInUrl, QrTicketImage: ProductionQrTicketImage } = await import(
      '../qr-ticket-image'
    );

    expect(buildQrCheckInUrl('token')).toBe(
      'https://browser-origin.example.com/field/check-in?ticket=token',
    );

    render(
      <ProductionQrTicketImage value="http://localhost:3000/field/check-in?ticket=token" />,
    );

    expect(screen.getByText('QR 티켓을 표시할 수 없습니다.')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-ticket-image')).not.toBeInTheDocument();
  });

  it('renders a real stable 220px square qr image for the HTTPS Grabit check-in URL', () => {
    renderQrTicketImage();

    expect(
      screen.getByText('QR 티켓이 준비되었습니다. 입장 시 현장 스태프가 QR을 확인합니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText('현장 검표 결과가 최종 입장 기준입니다.')).toBeInTheDocument();

    const qrRegion = screen.getByTestId('qr-ticket-image');
    expect(qrRegion).toHaveAttribute('data-qr-url', qrCheckInUrl);
    expect(qrRegion).toHaveStyle({ minWidth: '220px', minHeight: '220px' });

    const qrElement = qrRegion.querySelector('svg, canvas, img');
    expect(qrElement).not.toBeNull();
    expect(qrElement?.querySelector('title')).toHaveTextContent('티켓 검표 QR');
  });

  it('supports an explicit safe title and custom square size', () => {
    render(<QrTicketImage value={qrCheckInUrl} title="현장 입장 확인 QR" size={256} />);

    const qrRegion = screen.getByTestId('qr-ticket-image');
    expect(qrRegion).toHaveStyle({ minWidth: '256px', minHeight: '256px' });

    const qrElement = qrRegion.querySelector('svg');
    expect(qrElement?.querySelector('title')).toHaveTextContent('현장 입장 확인 QR');
  });

  it('does not print raw token, raw JTI, or full deep-link URL as visible text', () => {
    renderQrTicketImage();

    expect(screen.queryByText(rawToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawJTI, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(qrCheckInUrl, { exact: true })).not.toBeInTheDocument();

    const qrRegion = screen.getByTestId('qr-ticket-image');
    expect(within(qrRegion).queryByText(rawToken)).not.toBeInTheDocument();
    expect(within(qrRegion).queryByText(rawJTI)).not.toBeInTheDocument();
  });

  it('shows a safe fallback for invalid QR values without printing the unsafe value', () => {
    const invalidValue = `javascript:alert("${rawToken}")`;

    render(<QrTicketImage value={invalidValue} />);

    expect(screen.getByText('QR 티켓을 표시할 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.')).toBeInTheDocument();
    expect(screen.queryByText(invalidValue, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawToken, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByTestId('qr-ticket-image')).not.toBeInTheDocument();
  });
});
