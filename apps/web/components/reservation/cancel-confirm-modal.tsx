'use client';

import { useState } from 'react';
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
import type { CancellationQuote } from '@grabit/shared';

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
  }).format(date);
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
  onConfirm: (reason: string) => void;
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
  onConfirm,
  isLoading,
}: CancelConfirmModalProps) {
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).reservation.cancel;
  const [reason, setReason] = useState('');
  const [confirmStepOpen, setConfirmStepOpen] = useState(false);

  function handleConfirm() {
    if (!reason || !cancellationQuote) return;
    onConfirm(reason);
  }

  function resetInternalState() {
    setReason('');
    setConfirmStepOpen(false);
  }

  function handlePreviewOpenChange(value: boolean) {
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
    !reason || isLoading || isPreviewLoading || isPreviewError || !cancellationQuote;

  return (
    <>
      <Dialog open={open && !confirmStepOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              {copy.title}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              {copy.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
        onOpenChange={(value) => setConfirmStepOpen(value)}
      >
        <AlertDialogContent
          role="alertdialog"
          aria-modal="true"
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-semibold">
              {copy.confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-gray-600">
              {copy.confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 rounded-xl bg-gray-50 p-4">
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
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              variant="ghost"
              onClick={() => setConfirmStepOpen(false)}
            >
              {copy.previous}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={confirmDisabled}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {copy.processing}
                </>
              ) : (
                copy.confirmCta
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
