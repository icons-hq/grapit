'use client';

import type { CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QrTicketImageProps {
  value: string;
  title?: string;
  size?: number;
}

const DEFAULT_QR_SIZE = 220;
const QR_PADDING = 16;
const DEFAULT_QR_TITLE = '티켓 검표 QR';
const DEFAULT_PUBLIC_WEB_ORIGIN = 'https://heygrabit.com';

function getPublicWebOrigin(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_PUBLIC_WEB_ORIGIN;
  }

  try {
    const currentOrigin = new URL(window.location.origin);
    if (currentOrigin.protocol === 'https:') {
      return currentOrigin.origin;
    }
  } catch {
    // Fall through to the production Grabit origin.
  }

  return DEFAULT_PUBLIC_WEB_ORIGIN;
}

export function buildQrCheckInUrl(token: string): string {
  const url = new URL('/field/check-in', getPublicWebOrigin());
  url.searchParams.set('ticket', token);
  return url.toString();
}

function isHttpsQrValue(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function QrTicketImage({
  value,
  title = DEFAULT_QR_TITLE,
  size = DEFAULT_QR_SIZE,
}: QrTicketImageProps) {
  const qrSize = Math.max(DEFAULT_QR_SIZE, Math.floor(size));
  const imageSize = Math.max(160, qrSize - QR_PADDING * 2);
  const squareStyle: CSSProperties = {
    width: qrSize,
    minWidth: qrSize,
    height: qrSize,
    minHeight: qrSize,
  };

  if (!isHttpsQrValue(value)) {
    return (
      <div className="rounded-lg border border-[#F3E6A6] bg-[#FFFBEB] p-4 text-sm text-[#8B6306]">
        <p className="font-semibold">QR 티켓을 표시할 수 없습니다.</p>
        <p className="mt-1">잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">
          QR 티켓이 준비되었습니다. 입장 시 현장 스태프가 QR을 확인합니다.
        </p>
        <p className="mt-1 text-sm text-gray-600">
          현장 검표 결과가 최종 입장 기준입니다.
        </p>
      </div>
      <div
        data-testid="qr-ticket-image"
        data-qr-url={value}
        className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        style={squareStyle}
        aria-label={title}
      >
        <QRCodeSVG
          value={value}
          size={imageSize}
          bgColor="#FFFFFF"
          fgColor="#000000"
          level="M"
          marginSize={4}
          title={title}
        />
      </div>
    </div>
  );
}
