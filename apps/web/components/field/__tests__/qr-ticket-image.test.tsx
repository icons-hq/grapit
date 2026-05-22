import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { QrTicketImage } from '../qr-ticket-image';

const qrCheckInUrl =
  'https://heygrabit.com/field/check-in?ticket=phase27-opaque-ticket-token';
const rawToken = 'raw-token-phase27-should-not-render';
const rawJTI = 'raw-JTI-phase27-should-not-render';
const rawJwtPayload = '{"sub":"ticket","jti":"raw-JTI-phase27-should-not-render"}';

function renderQrTicketImage() {
  render(
    <QrTicketImage
      qrUrl={qrCheckInUrl}
      qrToken={rawToken}
      jti={rawJTI}
      reservationNumber="GRP-27-QR-0001"
      performanceTitle="Phase 27 Field Operations"
      showtimeAt="2026-07-04T10:00:00.000Z"
      seats={['VIP A열 1번']}
      status="ACTIVE"
    />,
  );
}

describe('QrTicketImage', () => {
  it('renders a real 200px square qr image for the HTTPS Grabit check-in URL', () => {
    renderQrTicketImage();

    expect(
      screen.getByText('QR 티켓이 준비되었습니다. 입장 시 현장 스태프가 QR을 확인합니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText('현장 검표 결과가 최종 입장 기준입니다.')).toBeInTheDocument();

    const qrRegion = screen.getByTestId('qr-ticket-image');
    expect(qrRegion).toHaveAttribute('data-qr-url', qrCheckInUrl);
    expect(qrRegion).toHaveStyle({ minWidth: '200px', minHeight: '200px' });

    const qrElement = qrRegion.querySelector('svg, canvas, img');
    expect(qrElement).not.toBeNull();
  });

  it('shows only buyer-safe metadata next to the qr code', () => {
    renderQrTicketImage();

    expect(screen.getByText('GRP-27-QR-0001')).toBeInTheDocument();
    expect(screen.getByText('Phase 27 Field Operations')).toBeInTheDocument();
    expect(screen.getByText('VIP A열 1번')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('does not print raw token, raw JTI, JWT payload, or full deep-link URL as visible text', () => {
    renderQrTicketImage();

    expect(screen.queryByText(rawToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawJTI, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawJwtPayload, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(qrCheckInUrl, { exact: true })).not.toBeInTheDocument();

    const qrRegion = screen.getByTestId('qr-ticket-image');
    expect(within(qrRegion).queryByText(/phase27-opaque-ticket-token/)).not.toBeInTheDocument();
  });
});
