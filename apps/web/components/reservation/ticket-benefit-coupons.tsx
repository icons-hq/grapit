'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gift, Loader2 } from 'lucide-react';
import type { BenefitEntitlement, BenefitRedemptionResponse, TicketItem } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { useBuyerBenefitRedeem } from '@/hooks/use-buyer-benefit-redeem';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';

type Locale = keyof BenefitEntitlement['displayCopy'];
type State = 'available' | 'used' | 'inactive';

// Every warning is shown together, regardless of the app's current language.
export const BENEFIT_USE_WARNINGS = [
  { lang: 'ko', label: '한국어', text: '현장 직원만 눌러주세요. 고객님은 직접 누르지 마세요. 사용 처리하면 이 베네핏 1개가 즉시 사용되며 취소하거나 다시 사용할 수 없습니다.' },
  { lang: 'en', label: 'English', text: 'For on-site staff only. Customers must not tap this button. Confirming immediately uses one benefit. It cannot be undone or used again.' },
  { lang: 'zh-CN', label: '中文', text: '仅限现场工作人员操作。顾客请勿自行点击。确认后将立即核销 1 份权益，无法撤销或再次使用。' },
  { lang: 'th', label: 'ภาษาไทย', text: 'สำหรับเจ้าหน้าที่หน้างานเท่านั้น ลูกค้าห้ามกดด้วยตนเอง เมื่อยืนยันจะใช้สิทธิ์ 1 รายการทันที ไม่สามารถยกเลิกหรือใช้ซ้ำได้' },
] as const;

export const BENEFIT_DUPLICATE_WARNINGS = [
  { lang: 'ko', text: '이미 사용된 베네핏입니다. 다시 제공하지 마세요.' },
  { lang: 'en', text: 'This benefit has already been used. Do not provide it again.' },
  { lang: 'zh-CN', text: '此权益已使用，请勿重复提供。' },
  { lang: 'th', text: 'สิทธิ์นี้ถูกใช้แล้ว ห้ามมอบสิทธิ์ซ้ำ' },
] as const;

const DUPLICATE_COPY = {
  ko: { title: '이미 사용된 베네핏', previousUse: '이전 사용 시각' },
  en: { title: 'Benefit already used', previousUse: 'Previously used at' },
  'zh-CN': { title: '此权益已使用', previousUse: '上次使用时间' },
  th: { title: 'สิทธิ์นี้ถูกใช้แล้ว', previousUse: 'เวลาที่ใช้สิทธิ์ก่อนหน้า' },
} as const;

const COPY = {
  ko: { paid: '추가 구매', open: '현장 사용', title: '베네핏을 사용 처리할까요?', cancel: '취소', confirm: '직원이 확인하고 1개 사용 처리', used: '사용 완료', close: '닫기', error: '사용 결과를 확인하지 못했습니다. 지급하기 전에 같은 버튼으로 다시 확인해주세요.', inactive: '현재 사용할 수 없는 베네핏입니다.', missing: '티켓 정보를 새로고침한 뒤 다시 시도해주세요.' },
  en: { paid: 'Purchased', open: 'Use at venue', title: 'Use this benefit?', cancel: 'Cancel', confirm: 'Staff: confirm and use one', used: 'Used', close: 'Close', error: 'The result could not be confirmed. Retry the same button before handing over the benefit.', inactive: 'This benefit is not available for use.', missing: 'Refresh your ticket details and try again.' },
  'zh-CN': { paid: '加购', open: '现场使用', title: '确认核销此权益？', cancel: '取消', confirm: '工作人员确认并核销 1 份', used: '已使用', close: '关闭', error: '暂时无法确认结果。请在发放权益前再次点击同一按钮确认。', inactive: '此权益当前无法使用。', missing: '请刷新票券信息后重试。' },
  th: { paid: 'ซื้อเพิ่มเติม', open: 'ใช้ที่งาน', title: 'ยืนยันใช้สิทธิ์นี้หรือไม่?', cancel: 'ยกเลิก', confirm: 'เจ้าหน้าที่ยืนยันและใช้ 1 สิทธิ์', used: 'ใช้แล้ว', close: 'ปิด', error: 'ยังยืนยันผลไม่ได้ โปรดกดปุ่มเดิมเพื่อตรวจสอบอีกครั้งก่อนมอบสิทธิ์', inactive: 'ยังไม่สามารถใช้สิทธิ์นี้ได้', missing: 'โปรดรีเฟรชข้อมูลบัตรแล้วลองอีกครั้ง' },
} as const;

function stateOf(benefit: BenefitEntitlement, status: TicketItem['status']): State {
  if (benefit.state === 'redeemed') return 'used';
  return status === 'ACTIVE' && benefit.state === 'active' ? 'available' : 'inactive';
}

function usedAt(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value)) + ' KST';
}

export function TicketBenefitCoupons({ reservationId, ticketItemId, benefits, ticketStatus, token, seatLabel, locale }: {
  reservationId: string;
  ticketItemId: string;
  benefits: BenefitEntitlement[];
  ticketStatus: TicketItem['status'];
  token: string | null;
  seatLabel: string;
  locale: Locale;
}) {
  const copy = COPY[locale];
  const labels = getVisibleCopy(locale).bookingExtra.completeCard.benefits;
  const mutation = useBuyerBenefitRedeem(reservationId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, BenefitRedemptionResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const attempts = useRef(new Map<string, string>());
  const submitting = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const currentBenefits = benefits.map((benefit) => {
    const result = results[benefit.id];
    if (result?.outcome === 'duplicate') return {
      ...(result.benefitEntitlement ?? benefit), state: 'redeemed' as const,
      redeemedAt: result.priorRedemption.redeemedAt,
    };
    return result?.benefitEntitlement ?? benefit;
  });
  const selected = currentBenefits.find((benefit) => benefit.id === selectedId);
  const selectedState = selected ? stateOf(selected, ticketStatus) : 'inactive';
  // Only this device's successful receipt proves a new handover. A refresh may
  // discover that another device already used the coupon while this dialog was
  // open; that state must never look like a newly successful confirmation.
  const confirmedHere = selectedId !== null && results[selectedId]?.outcome === 'redeemed';
  const showAlreadyUsed = selectedState === 'used' && !confirmedHere;
  const kindLabel = (benefit: BenefitEntitlement) => benefit.kind === 'paid' ? copy.paid : benefit.kind === 'included' ? labels.included : labels.limited;
  const stateLabel = (state: State) => state === 'used' ? labels.used : state === 'inactive' ? labels.inactive : labels.available;

  async function confirmUse() {
    if (!selected || selectedState !== 'available' || submitting.current) return;
    if (!token) { setError(copy.missing); return; }
    submitting.current = true;
    setError(null);
    let deviceAttemptId = attempts.current.get(selected.id);
    if (!deviceAttemptId) {
      deviceAttemptId = crypto.randomUUID();
      attempts.current.set(selected.id, deviceAttemptId);
    }
    try {
      const result = await mutation.mutateAsync({ token, showtimeId: selected.showtimeId, benefitEntitlementId: selected.id, deviceAttemptId, confirmed: true });
      if (result.outcome === 'redeemed' || result.outcome === 'duplicate') {
        setResults((previous) => ({ ...previous, [selected.id]: result }));
      } else {
        attempts.current.delete(selected.id);
        setError(copy.inactive);
      }
    } catch {
      // Keep this attempt id on all retries, including closing/reopening after
      // a lost response, so one confirmation never becomes a second use.
      setError(copy.error);
    } finally {
      submitting.current = false;
    }
  }

  return <div data-testid={`ticket-benefits-${ticketItemId}`} className="mt-4 border-t border-border pt-4">
    <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Gift className="h-4 w-4" aria-hidden="true" />{labels.title}</h4>
    {currentBenefits.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{labels.empty}</p> : <ul className="mt-3 flex flex-col gap-2">
      {currentBenefits.map((benefit) => {
        const state = stateOf(benefit, ticketStatus);
        const same = currentBenefits.filter((candidate) => candidate.benefitIdentity === benefit.benefitIdentity && candidate.kind === benefit.kind);
        const unit = same.length > 1 ? ` ${same.findIndex((candidate) => candidate.id === benefit.id) + 1}/${same.length}` : '';
        const name = benefit.displayCopy[locale].name;
        return <li key={benefit.id} data-testid={`benefit-coupon-${benefit.id}`} className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">{name}{unit}</p>
            <div className="flex flex-wrap gap-1 text-xs"><Badge variant="outline">{kindLabel(benefit)}</Badge><Badge variant={state === 'available' ? 'default' : state === 'used' ? 'secondary' : 'outline'}>{stateLabel(state)}</Badge></div>
          </div>
          {state === 'used' && benefit.redeemedAt && <p className="mt-2 text-xs text-muted-foreground">{labels.redeemedAt.replace('{date}', usedAt(benefit.redeemedAt, locale))}</p>}
          {state === 'available' && <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11 w-full" disabled={!token}
            aria-label={`${name}${unit} ${copy.open}`} onClick={() => { setError(null); setSelectedId(benefit.id); }}>{copy.open}</Button>}
        </li>;
      })}
    </ul>}
    <AlertDialog open={Boolean(selectedId)} onOpenChange={(open) => { if (!open && !submitting.current) setSelectedId(null); }}>
      <AlertDialogContent className="max-h-[92dvh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl p-5 sm:max-w-lg" onOpenAutoFocus={(event) => { event.preventDefault(); cancelButton.current?.focus(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle className="pr-5 leading-7">{showAlreadyUsed ? DUPLICATE_COPY[locale].title : selectedState === 'used' ? copy.used : copy.title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words text-left">{selected?.displayCopy[locale].name} · {seatLabel}</AlertDialogDescription>
        </AlertDialogHeader>
        {showAlreadyUsed ? <div role="alert" data-testid="benefit-duplicate-warning" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-foreground">
          <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
          {BENEFIT_DUPLICATE_WARNINGS.map((warning) => <p key={warning.lang} lang={warning.lang} className="text-sm font-semibold leading-relaxed">{warning.text}</p>)}
          {selected?.redeemedAt && <p className="text-sm">{DUPLICATE_COPY[locale].previousUse}: {usedAt(selected.redeemedAt, locale)}</p>}
        </div> : selectedState === 'used' ? <div role="status" className="flex flex-col gap-3 rounded-xl bg-primary/5 p-4 text-primary">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          <p className="font-semibold">사용 완료 · Used · 已使用 · ใช้แล้ว</p>
          {selected?.redeemedAt && <p className="text-sm">{usedAt(selected.redeemedAt, locale)}</p>}
        </div> : <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" data-testid="benefit-use-warning">
          {BENEFIT_USE_WARNINGS.map((warning) => <p key={warning.lang} lang={warning.lang} className="text-sm leading-relaxed text-foreground"><strong className="mb-0.5 block text-xs">{warning.label}</strong>{warning.text}</p>)}
        </div>}
        {error && selectedState !== 'used' && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
        {selectedState === 'inactive' && !error && <p role="alert" className="text-sm text-muted-foreground">{copy.inactive}</p>}
        <AlertDialogFooter className="sticky -bottom-5 -mx-5 -mb-5 gap-2 border-t bg-background p-5 sm:flex-col">
          {selectedState === 'used' ? <AlertDialogCancel ref={cancelButton} className="min-h-11 w-full">{copy.close}</AlertDialogCancel> : <>
            <Button type="button" className="min-h-12 w-full whitespace-normal" disabled={mutation.isPending || selectedState !== 'available' || !token} onClick={() => { void confirmUse(); }}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{copy.confirm}
            </Button>
            <AlertDialogCancel ref={cancelButton} className="min-h-11 w-full" disabled={mutation.isPending}>{copy.cancel}</AlertDialogCancel>
          </>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
