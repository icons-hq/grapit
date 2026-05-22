import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { QrTicketImage } from '../qr-ticket-image';

const rawToken = 'raw-token-phase27-should-not-render';
const rawJTI = 'raw-JTI-phase27-should-not-render';
const qrCheckInUrl = `https://heygrabit.com/field/check-in?ticket=${rawToken}&jti=${rawJTI}`;

function renderQrTicketImage() {
  render(<QrTicketImage value={qrCheckInUrl} />);
}

describe('QrTicketImage', () => {
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
