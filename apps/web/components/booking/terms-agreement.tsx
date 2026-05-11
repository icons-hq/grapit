'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface TermsAgreementProps {
  agreed: boolean;
  onAgreementChange: (agreed: boolean) => void;
}

export function TermsAgreement({ agreed, onAgreementChange }: TermsAgreementProps) {
  const [bookingTerms, setBookingTerms] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState(false);
  const [dialogContent, setDialogContent] = useState<{ title: string; content: string } | null>(null);

  const allChecked = bookingTerms && privacyNotice;

  useEffect(() => {
    onAgreementChange(allChecked);
  }, [allChecked, onAgreementChange]);

  const handleAllToggle = useCallback((checked: boolean | 'indeterminate') => {
    const value = checked === true;
    setBookingTerms(value);
    setPrivacyNotice(value);
  }, []);

  return (
    <Card>
      <CardContent className="space-y-3">
        <h2 className="text-base font-semibold">약관 동의</h2>

        <div role="group" aria-label="약관 동의">
          <label className="flex cursor-pointer items-center gap-3 py-2">
            <Checkbox
              checked={allChecked}
              onCheckedChange={handleAllToggle}
              aria-label="전체 동의"
            />
            <span className="text-sm font-semibold">전체 동의</span>
          </label>

          <Separator className="my-2" />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-3 py-1.5">
                <Checkbox
                  checked={bookingTerms}
                  onCheckedChange={(checked) => setBookingTerms(checked === true)}
                />
                <span className="text-sm">예매/취소 규정에 동의합니다 (필수)</span>
              </label>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-gray-500"
                onClick={() =>
                  setDialogContent({
                    title: '예매/취소 규정',
                    content:
                      '1. 예매 완료 후 취소 시 공연 시작 24시간 전까지 전액 환불 가능합니다.\n\n2. 공연 시작 24시간 이내에는 취소가 불가합니다.\n\n3. 예매 시 선택한 좌석은 결제 완료 시점에 확정됩니다.\n\n4. 결제 완료 후 좌석 변경은 취소 후 재예매로만 가능합니다.\n\n5. 공연 당일 부도 시 환불이 불가합니다.\n\n6. 천재지변 등 불가항력적 사유로 공연이 취소된 경우 전액 환불됩니다.',
                  })
                }
              >
                보기
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-3 py-1.5">
                <Checkbox
                  checked={privacyNotice}
                  onCheckedChange={(checked) => setPrivacyNotice(checked === true)}
                />
                <span className="text-sm">개인정보 처리 안내를 확인했습니다 (필수)</span>
              </label>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-gray-500"
                onClick={() =>
                  setDialogContent({
                    title: '개인정보 처리 안내',
                    content:
                      '1. Grabit은 예매 확인, 결제, QR 입장, 환불 및 고객 상담을 위해 예매자 정보를 처리합니다.\n\n2. GMMTV, iQIYI 등 해외 엔터테인먼트사 또는 공연 주최사에는 예매자 개인정보를 제공하지 않습니다.\n\n3. 결제 처리, 이메일/SMS 발송 등 서비스 제공에 필요한 수탁자에게는 개인정보처리방침에 고지된 범위 안에서만 처리위탁합니다.\n\n4. 보유 기간과 이용자 권리는 개인정보처리방침을 따릅니다.',
                  })
                }
              >
                보기
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={!!dialogContent} onOpenChange={() => setDialogContent(null)}>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{dialogContent?.title}</DialogTitle>
              <DialogDescription className="sr-only">
                {dialogContent?.title} 내용
              </DialogDescription>
            </DialogHeader>
            <div className="whitespace-pre-wrap text-sm text-gray-700">
              {dialogContent?.content}
            </div>
            <DialogFooter>
              <Button onClick={() => setDialogContent(null)}>확인</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
