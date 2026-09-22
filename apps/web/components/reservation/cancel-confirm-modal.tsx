'use client';

import { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import type { CancellationQuote, RefundPreviewResponse } from '@grabit/shared';
import { getCancellationCopy, getCancellationPolicyLabel } from '@/lib/i18n/cancellation-copy';

function formatDateTime(dateString: string | null | undefined, locale: string): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(date) + ' KST';
}

interface CancelConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refundAmount: number;
  cancellationQuote?: CancellationQuote | null;
  paymentMethod: string;
  expectedDepositAt?: string | null;
  releaseWindowMinutes?: {
    min: number;
    max: number;
  } | null;
  isPreviewLoading?: boolean;
  isPreviewError?: boolean;
  selectedSeats?: string[];
  remainingSeats?: string[];
  providerRefund?: RefundPreviewResponse['providerRefund'];
  blockedReason?: string | null;
  canConfirm?: boolean;
  onRetryPreview?: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  isLoading: boolean;
}

export function CancelConfirmModal({
  open,
  onOpenChange,
  refundAmount,
  cancellationQuote,
  paymentMethod,
  expectedDepositAt,
  releaseWindowMinutes,
  isPreviewLoading = false,
  isPreviewError = false,
  selectedSeats, remainingSeats, providerRefund, blockedReason, canConfirm = true, onRetryPreview,
  onConfirm,
  isLoading,
}: CancelConfirmModalProps) {
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).reservation.cancel;
  const cancellationCopy = getCancellationCopy(locale);
  const [reason, setReason] = useState('');
  const [confirmStepOpen, setConfirmStepOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const requestPending = useRef(false);
  const [submitError, setSubmitError] = useState(false);

  async function handleConfirm() {
    if (!reason || !cancellationQuote || requestPending.current) return;
    requestPending.current = true;
    setSubmitting(true);
    setSubmitError(false);
    try {
      await onConfirm(reason);
      resetInternalState();
      onOpenChange(false);
    } catch {
      setConfirmStepOpen(false);
      setSubmitError(true);
      onRetryPreview?.();
    } finally {
      requestPending.current = false;
      setSubmitting(false);
    }
  }

  function resetInternalState() {
    setReason('');
    setConfirmStepOpen(false);
    setSubmitError(false);
  }

  function handlePreviewOpenChange(value: boolean) {
    if (requestPending.current) return;
    if (!value) {
      resetInternalState();
    }
    onOpenChange(value);
  }

  function handleMoveToConfirm() {
    if (!reason || !cancellationQuote || isPreviewLoading || isPreviewError) return;
    setConfirmStepOpen(true);
  }

  const formattedExpectedDepositAt = formatDateTime(expectedDepositAt, locale);
  const formattedRefundAmount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(refundAmount);
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'KRW',
      maximumFractionDigits: 0,
    }).format(amount);
  const quoteUnavailable = !isPreviewLoading && !isPreviewError && !cancellationQuote;
  const confirmDisabled =
    !reason || submitting || isLoading || isPreviewLoading || isPreviewError || !cancellationQuote || !canConfirm || Boolean(blockedReason);
  const selectionSummary = selectedSeats ? (
    <div className="space-y-2 rounded-xl border border-gray-200 p-4 text-sm">
      <p className="font-semibold">{cancellationCopy.selected}: {selectedSeats.join(', ')}</p>
      <p className="text-gray-600">{cancellationCopy.remaining}: {remainingSeats?.length ? remainingSeats.join(', ') : cancellationCopy.none}</p>
    </div>
  ) : null;
  const providerRefundSummary = providerRefund ? (
    <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-3">
      <span className="text-sm text-gray-600">{cancellationCopy.providerRefund}</span>
      <strong>{providerRefund.currency} {providerRefund.amountDecimal}</strong>
    </div>
  ) : null;

  return (
    <>
      <Dialog open={open && !confirmStepOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              {copy.title}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              {selectedSeats ? cancellationCopy.selectionNotice : copy.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {selectionSummary}
            {(blockedReason || submitError) && <p role="alert" className="text-sm text-red-700">{blockedReason || cancellationCopy.unknown}</p>}
            <div>
              <label
                htmlFor="cancel-reason"
                className="mb-2 block text-sm font-semibold text-gray-700"
              >
                {copy.reasonLabel}
              </label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="cancel-reason" className="w-full">
                  <SelectValue placeholder={copy.reasonPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {copy.reasons.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">{copy.refundAmount}</span>
                <span className="text-base font-semibold text-gray-900">
                  {cancellationQuote ? formattedRefundAmount : '-'}
                </span>
              </div>
              {isPreviewLoading && (
                <div className="flex items-center gap-2 border-t border-gray-200 pt-3 text-sm text-gray-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{copy.quoteLoading}</span>
                </div>
              )}
              {isPreviewError && (
                <p className="border-t border-gray-200 pt-3 text-sm font-semibold text-[#C62828]">
                  {copy.quoteError}
                </p>
              )}
              {(isPreviewError || submitError) && onRetryPreview && <Button variant="outline" onClick={onRetryPreview}>{cancellationCopy.retry}</Button>}
              {quoteUnavailable && (
                <p className="border-t border-gray-200 pt-3 text-sm font-semibold text-[#C62828]">
                  {copy.quoteUnavailable}
                </p>
              )}
              {cancellationQuote && (
                <div className="space-y-2 border-t border-gray-200 pt-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-600">{copy.originalPaymentAmount}</span>
                    <span className="text-sm font-medium text-gray-900">
                      {formatCurrency(cancellationQuote.originalPaymentAmount)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{cancellationCopy.policy}: {cancellationQuote.policyCodes.map((code) => getCancellationPolicyLabel(code, locale)).join(' · ')}</p>
                  <p className="text-sm text-gray-600">{cancellationCopy.retainedFee}: {formatCurrency(cancellationQuote.ticketServiceFeeTotal - cancellationQuote.serviceFeeRefundTotal)}</p>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-600">{copy.ticketSubtotal}</span>
                    <span className="text-sm font-medium text-gray-900">
                      {formatCurrency(cancellationQuote.ticketSubtotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-600">{copy.cancellationFee}</span>
                    <span className="text-sm font-semibold text-[#C62828]">
                      {cancellationQuote.cancellationFeeTotal > 0 ? '-' : ''}
                      {formatCurrency(cancellationQuote.cancellationFeeTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-600">{copy.serviceFeeRefund}</span>
                    <span className="text-sm font-medium text-gray-900">
                      {formatCurrency(cancellationQuote.serviceFeeRefundTotal)}
                    </span>
                  </div>
                </div>
              )}
              {providerRefundSummary}
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">{copy.refundMethod}</span>
                <span className="text-sm text-gray-700">
                  {copy.refundMethodValue.replace('{paymentMethod}', paymentMethod)}
                </span>
              </div>
              {formattedExpectedDepositAt && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-600">{copy.expectedDeposit}</span>
                  <span className="text-right text-sm font-semibold text-gray-900">
                    {formattedExpectedDepositAt}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-[#E5D9FF] bg-[#FAF7FF] p-4">
              <p className="text-sm text-gray-700">
                {copy.refundTimingNotice}
              </p>
              <p className="text-sm text-gray-700">{copy.delayedReopenNotice}</p>
              {releaseWindowMinutes && (
                <p className="text-sm text-gray-700">
                  {copy.releaseWindow
                    .replace('{min}', String(releaseWindowMinutes.min))
                    .replace('{max}', String(releaseWindowMinutes.max))}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handlePreviewOpenChange(false)}
            >
              {copy.close}
            </Button>
            <Button
              type="button"
              onClick={handleMoveToConfirm}
              disabled={confirmDisabled}
            >
              {copy.finalCheck}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={open && confirmStepOpen}
        onOpenChange={(value) => { if (!requestPending.current) setConfirmStepOpen(value); }}
      >
        <AlertDialogContent
          className="max-h-[90dvh] overflow-y-auto"
          role="alertdialog"
          aria-modal="true"
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-semibold">
              {remainingSeats?.length ? cancellationCopy.confirmTitle : copy.confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-gray-600">
              {copy.confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 rounded-xl bg-gray-50 p-4">
            {selectionSummary}
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">{copy.reasonLabel}</span>
              <span className="text-sm font-semibold text-gray-900">{reason}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">{copy.refundAmount}</span>
              <span className="text-sm font-semibold text-gray-900">
                {formattedRefundAmount}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">{copy.refundMethod}</span>
              <span className="text-sm text-gray-700">
                {copy.refundMethodValue.replace('{paymentMethod}', paymentMethod)}
              </span>
            </div>
            {providerRefundSummary}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              variant="ghost"
              disabled={submitting || isLoading}
              onClick={() => setConfirmStepOpen(false)}
            >
              {copy.previous}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              className="bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800"
              onClick={handleConfirm}
              disabled={confirmDisabled}
            >
              {isLoading || submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {copy.processing}
                </>
              ) : (
                remainingSeats?.length ? cancellationCopy.confirmSelected : copy.confirmCta
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
