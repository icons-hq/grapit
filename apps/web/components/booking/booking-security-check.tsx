'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient, ApiClientError } from '@/lib/api-client';

export interface BookingChallenge { sitekey: string; binding: string; showtimeId: string }
export function readBookingChallenge(error: unknown, showtimeId: string): BookingChallenge | undefined {
  if (!(error instanceof ApiClientError) || error.statusCode !== 403 || error.message !== 'SECURITY_CHALLENGE_REQUIRED') return;
  const data = error.data as Partial<BookingChallenge> | null;
  if (typeof data?.sitekey === 'string' && typeof data.binding === 'string') {
    return { sitekey: data.sitekey, binding: data.binding, showtimeId };
  }
}

interface Turnstile {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
function widget() { return (window as Window & { turnstile?: Turnstile }).turnstile; }

let loading: Promise<Turnstile> | undefined;
function loadWidget(): Promise<Turnstile> {
  const existing = widget();
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { script.remove(); loading = undefined; reject(new Error('Widget unavailable')); };
    const timeout = setTimeout(fail, 15_000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => { clearTimeout(timeout); const api = widget(); if (api) resolve(api); else fail(); };
    script.onerror = () => { clearTimeout(timeout); fail(); };
    document.head.appendChild(script);
  });
  return loading;
}

const copy = {
  ko: { title: '좌석 선택 전 보안 확인', body: '확인을 마친 뒤 원하는 좌석을 다시 선택해 주세요.', retry: '다시 확인', close: '닫기', failed: '확인을 완료하지 못했습니다. 다시 시도해 주세요.', done: '보안 확인을 마쳤습니다. 좌석을 선택해 주세요.' },
  en: { title: 'Verify before selecting a seat', body: 'Complete the check, then select your seat again.', retry: 'Try again', close: 'Close', failed: 'Verification could not be completed. Please try again.', done: 'Verification complete. Choose your seat.' },
  th: { title: 'ยืนยันก่อนเลือกที่นั่ง', body: 'เมื่อยืนยันแล้ว กรุณาเลือกที่นั่งอีกครั้ง', retry: 'ลองอีกครั้ง', close: 'ปิด', failed: 'ยืนยันไม่สำเร็จ กรุณาลองอีกครั้ง', done: 'ยืนยันแล้ว กรุณาเลือกที่นั่ง' },
  'zh-CN': { title: '选座前请完成安全验证', body: '验证完成后，请重新选择座位。', retry: '重试', close: '关闭', failed: '未能完成验证，请重试。', done: '验证成功，请选择座位。' },
};

export function BookingSecurityCheck({ challenge, locale, onClose }: {
  challenge: BookingChallenge; locale: keyof typeof copy; onClose: (message?: string) => void;
}) {
  const text = copy[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    let active = true;
    let id: string | undefined;
    void loadWidget().then(api => {
      if (!active || !container.current) return;
      id = api.render(container.current, {
        sitekey: challenge.sitekey, action: 'booking_seat', cData: challenge.binding, language: locale,
        callback: async (token: string) => {
          try {
            await apiClient.post('/api/v1/booking/seats/verify', { showtimeId: challenge.showtimeId, token }, { showErrorToast: false });
            if (active) onClose(text.done);
          } catch { if (active) setFailed(true); }
        },
        'expired-callback': () => { if (active) setFailed(true); },
        'error-callback': () => { if (active) setFailed(true); },
      });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (id) widget()?.remove(id); };
  }, [attempt, challenge, locale, onClose, text.done]);

  return <dialog ref={dialog} aria-labelledby="booking-check-title" onCancel={() => onClose()}
    className="fixed inset-0 m-auto w-[min(92vw,24rem)] rounded-xl border bg-white p-5 shadow-xl backdrop:bg-black/45">
    <h2 id="booking-check-title" className="text-lg font-semibold">{text.title}</h2>
    <p className="my-3 text-sm">{text.body}</p>
    <div ref={container} />
    {failed && <p role="alert" className="mt-2 text-sm">{text.failed}</p>}
    <div className="mt-3 flex gap-4">
      {failed && <button type="button" className="min-h-11 underline" onClick={() => {
        setFailed(false); setAttempt(value => value + 1);
      }}>{text.retry}</button>}
      <button type="button" className="min-h-11 underline" onClick={() => onClose()}>{text.close}</button>
    </div>
  </dialog>;
}
