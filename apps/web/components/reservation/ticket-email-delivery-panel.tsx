'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Mail, MailWarning } from 'lucide-react';
import type { TicketEmailDelivery } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useRequestAccountEmailVerification,
  useSendReservationTicketEmail,
  useVerifyAccountEmail,
} from '@/hooks/use-reservations';
import { useAuthStore } from '@/stores/use-auth-store';

interface TicketEmailDeliveryPanelProps {
  reservationId: string;
  delivery: TicketEmailDelivery;
}

type PanelMessage =
  | { tone: 'success'; text: string }
  | { tone: 'default'; text: string }
  | null;

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${h}:${min}`;
}

export function TicketEmailDeliveryPanel({
  reservationId,
  delivery,
}: TicketEmailDeliveryPanelProps) {
  const [sentDelivery, setSentDelivery] =
    useState<TicketEmailDelivery | null>(null);
  const [email, setEmail] = useState(
    delivery.isPlaceholderEmail ? '' : delivery.email,
  );
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  const accessToken = useAuthStore((state) => state.accessToken);
  const setAuth = useAuthStore((state) => state.setAuth);
  const requestVerification = useRequestAccountEmailVerification();
  const verifyAccountEmail = useVerifyAccountEmail();
  const sendTicketEmail = useSendReservationTicketEmail();

  const isBusy =
    requestVerification.isPending ||
    verifyAccountEmail.isPending ||
    sendTicketEmail.isPending;
  const currentDelivery = sentDelivery ?? delivery;
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const canRequestCode = normalizedEmail.length > 0 && !isBusy;
  const canVerifyAndSend =
    code.length === 6 && normalizedEmail.length > 0 && !isBusy;
  const sendButtonLabel =
    currentDelivery.status === 'sent'
      ? '티켓 이메일 다시 보내기'
      : '티켓 이메일 보내기';

  async function handleSendTicketEmail() {
    const result = await sendTicketEmail.mutateAsync({ reservationId });
    setSentDelivery(result.ticketEmailDelivery);
    setMessage({ tone: 'success', text: '티켓 이메일을 발송했습니다.' });
  }

  async function handleRequestCode() {
    await requestVerification.mutateAsync({ email: normalizedEmail });
    setCodeSent(true);
    setMessage({ tone: 'default', text: '인증번호를 이메일로 보냈습니다.' });
  }

  async function handleVerifyAndSend() {
    const result = await verifyAccountEmail.mutateAsync({
      email: normalizedEmail,
      code,
    });
    if (accessToken) {
      setAuth(accessToken, result.user);
    }

    const sendResult = await sendTicketEmail.mutateAsync({ reservationId });
    setSentDelivery(sendResult.ticketEmailDelivery);
    setCode('');
    setCodeSent(false);
    setMessage({ tone: 'success', text: '인증이 완료되어 티켓 이메일을 발송했습니다.' });
  }

  if (currentDelivery.canSend) {
    return (
      <div className="rounded-xl border border-white/80 bg-white/90 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#6C3CE0]" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-gray-900">티켓 이메일</p>
              <p className="break-all text-gray-700">{currentDelivery.email}</p>
              {currentDelivery.lastSentAt ? (
                <p className="text-gray-500">
                  마지막 발송 {formatDateTime(currentDelivery.lastSentAt)}
                </p>
              ) : currentDelivery.scheduledAt ? (
                <p className="text-gray-500">
                  예약 발송 {formatDateTime(currentDelivery.scheduledAt)}
                </p>
              ) : (
                <p className="text-gray-500">
                  QR 티켓 안내 메일은 공연 24시간 전에 다시 발송됩니다.
                </p>
              )}
              {message && (
                <p
                  role={message.tone === 'success' ? 'status' : undefined}
                  className={
                    message.tone === 'success'
                      ? 'text-[#15803D]'
                      : 'text-gray-600'
                  }
                >
                  {message.text}
                </p>
              )}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleSendTicketEmail}
            disabled={sendTicketEmail.isPending}
            className="w-full sm:w-auto"
          >
            {sendTicketEmail.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            {sendButtonLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#F7D7A8] bg-[#FFFBEB] p-4">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-gray-900">
              티켓 이메일 인증이 필요합니다
            </p>
            <p className="text-gray-700">
              실제로 받을 수 있는 이메일을 인증하면 티켓을 이메일로 받을 수 있습니다.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor={`ticket-email-${reservationId}`} className="text-sm">
              이메일
            </Label>
            <Input
              id={`ticket-email-${reservationId}`}
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setCodeSent(false);
                setMessage(null);
              }}
              disabled={isBusy}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRequestCode}
            disabled={!canRequestCode}
            className="w-full sm:w-auto"
          >
            {requestVerification.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            인증번호 받기
          </Button>
        </div>

        {codeSent && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,160px)_auto] sm:items-end">
            <div className="space-y-2">
              <Label
                htmlFor={`ticket-email-code-${reservationId}`}
                className="text-sm"
              >
                인증번호
              </Label>
              <Input
                id={`ticket-email-code-${reservationId}`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  const nextCode = event.target.value.replace(/[^0-9]/g, '');
                  setCode(nextCode.slice(0, 6));
                }}
                disabled={isBusy}
              />
            </div>
            <Button
              type="button"
              onClick={handleVerifyAndSend}
              disabled={!canVerifyAndSend}
              className="w-full sm:w-auto"
            >
              {verifyAccountEmail.isPending || sendTicketEmail.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              인증하고 티켓 받기
            </Button>
          </div>
        )}

        {message && (
          <p
            role={message.tone === 'success' ? 'status' : undefined}
            className={
              message.tone === 'success'
                ? 'text-sm text-[#15803D]'
                : 'text-sm text-[#92400E]'
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
