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

const CANCEL_REASONS = [
  '단순 변심',
  '일정 변경',
  '다른 좌석으로 재예매',
  '기타',
] as const;

const DELAYED_REOPEN_NOTICE =
  '취소된 좌석은 즉시 재오픈되지 않을 수 있으며, 잠시 후 다시 판매될 수 있습니다';

function formatDateTime(dateString?: string | null): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const day = days[date.getDay()];
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} (${day}) ${h}:${min}`;
}

interface CancelConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refundAmount: number;
  paymentMethod: string;
  expectedDepositAt?: string | null;
  releaseWindowMinutes?: {
    min: number;
    max: number;
  } | null;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
}

export function CancelConfirmModal({
  open,
  onOpenChange,
  refundAmount,
  paymentMethod,
  expectedDepositAt,
  releaseWindowMinutes,
  onConfirm,
  isLoading,
}: CancelConfirmModalProps) {
  const [reason, setReason] = useState('');
  const [confirmStepOpen, setConfirmStepOpen] = useState(false);

  function handleConfirm() {
    if (!reason) return;
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
    if (!reason) return;
    setConfirmStepOpen(true);
  }

  const formattedExpectedDepositAt = formatDateTime(expectedDepositAt);

  return (
    <>
      <Dialog open={open && !confirmStepOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              환불 및 재오픈 안내
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              예매 전체가 취소됩니다. 일부 좌석만 취소할 수 없습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="cancel-reason"
                className="mb-2 block text-sm font-semibold text-gray-700"
              >
                취소 사유
              </label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="cancel-reason" className="w-full">
                  <SelectValue placeholder="취소 사유를 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">환불 예정 금액</span>
                <span className="text-base font-semibold text-gray-900">
                  {refundAmount.toLocaleString('ko-KR')}원
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">환불 수단</span>
                <span className="text-sm text-gray-700">{paymentMethod} 결제 취소</span>
              </div>
              {formattedExpectedDepositAt && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-600">예상 입금 시점</span>
                  <span className="text-right text-sm font-semibold text-gray-900">
                    {formattedExpectedDepositAt}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-[#E5D9FF] bg-[#FAF7FF] p-4">
              <p className="text-sm text-gray-700">
                환불 반영 속도는 결제수단과 카드사 처리 시간에 따라 달라질 수 있습니다.
              </p>
              <p className="text-sm text-gray-700">{DELAYED_REOPEN_NOTICE}</p>
              {releaseWindowMinutes && (
                <p className="text-sm text-gray-700">
                  취소 좌석은 보통 {releaseWindowMinutes.min}~{releaseWindowMinutes.max}
                  분 사이 랜덤하게 다시 판매될 수 있습니다.
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
              닫기
            </Button>
            <Button
              type="button"
              onClick={handleMoveToConfirm}
              disabled={!reason || isLoading}
            >
              마지막 확인
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
              예매를 취소하시겠습니까?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-gray-600">
              환불 요청 후에는 되돌릴 수 없습니다. 환불 금액과 재오픈 지연 가능성을 다시 확인해주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 rounded-xl bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">취소 사유</span>
              <span className="text-sm font-semibold text-gray-900">{reason}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">환불 예정 금액</span>
              <span className="text-sm font-semibold text-gray-900">
                {refundAmount.toLocaleString('ko-KR')}원
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">환불 수단</span>
              <span className="text-sm text-gray-700">{paymentMethod} 결제 취소</span>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              variant="ghost"
              onClick={() => setConfirmStepOpen(false)}
            >
              이전으로
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={!reason || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  취소 처리 중...
                </>
              ) : (
                '예매 취소'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
