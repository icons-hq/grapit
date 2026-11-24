'use client';

import { useState } from 'react';
import type { PaymentInfo, SupportedLocale } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { formatEventTimeWithKstAnchor } from '@/lib/i18n/format';
import { getPaymentRecoveryCopy } from '@/lib/booking/payment-recovery-copy';
import { useServerTimeReached } from '@/hooks/use-server-clock';

const copy = {
  ko: { title: '가상계좌 입금 대기', body: '아래 계좌에 정확한 금액을 입금해 주세요. 입금이 확인되면 티켓이 발급됩니다.',
    bank: '입금 은행', account: '계좌번호', amount: '입금 금액', due: '입금기한', elapsed: '입금기한이 지났습니다. 입금 결과를 확인하고 있습니다.',
    close: '미입금 예매 취소', confirm: '가상계좌를 반납하고 좌석을 취소할까요?', yes: '예매 취소하기', back: '돌아가기' },
  en: { title: 'Awaiting bank deposit', body: 'Transfer the exact amount to the account below. Your tickets will be issued once the deposit is confirmed.',
    bank: 'Bank', account: 'Account number', amount: 'Amount to transfer', due: 'Deposit deadline', elapsed: 'The deadline has passed. We are checking the deposit.',
    close: 'Cancel unpaid booking', confirm: 'Close this account and release the seats?', yes: 'Cancel booking', back: 'Go back' },
  'zh-CN': { title: '等待虚拟账户入账', body: '请将准确金额转入以下账户。到账确认后将出票。', bank: '银行', account: '账号', amount: '转账金额', due: '入账截止时间',
    elapsed: '入账期限已过，正在核实汇款结果。', close: '取消未付款预订', confirm: '关闭此账户并释放座位吗？', yes: '确认取消', back: '返回' },
  th: { title: 'รอโอนเงินเข้าบัญชีเสมือน', body: 'กรุณาโอนเงินตามยอดที่ระบุ ระบบจะออกบัตรเมื่อยืนยันยอดแล้ว',
    bank: 'ธนาคาร', account: 'เลขบัญชี', amount: 'ยอดโอน', due: 'กำหนดโอนเงิน', elapsed: 'หมดเวลาโอนเงินแล้ว กำลังตรวจสอบยอด',
    close: 'ยกเลิกการจองที่ยังไม่ชำระ', confirm: 'ปิดบัญชีนี้และคืนที่นั่งหรือไม่', yes: 'ยืนยันการยกเลิก', back: 'ย้อนกลับ' },
};
// Toss Bank Codes (two-digit response codes).
const banks: Record<string, [string, string]> = {
  '02': ['KDB산업은행','KDB'], '03': ['IBK기업은행','IBK'], '06': ['KB국민은행','KB Kookmin'],
  '07': ['Sh수협은행','Suhyup'], '11': ['NH농협은행','NH Nonghyup'], '12': ['지역농축협','Local Nonghyup'],
  '20': ['우리은행','Woori'], '23': ['SC제일은행','Standard Chartered'], '27': ['씨티은행','Citibank'],
  '31': ['iM뱅크','iM Bank'], '32': ['부산은행','Busan Bank'], '34': ['광주은행','Gwangju Bank'],
  '35': ['제주은행','Jeju Bank'], '37': ['전북은행','Jeonbuk Bank'], '39': ['경남은행','Kyongnam Bank'],
  '45': ['새마을금고','MG'], '48': ['신협','Credit Union'], '50': ['저축은행','Savings Bank'],
  '64': ['산림조합','Forestry Cooperative'], '71': ['우체국','Korea Post'], '81': ['하나은행','Hana'],
  '88': ['신한은행','Shinhan'], '89': ['케이뱅크','Kbank'], '90': ['카카오뱅크','KakaoBank'], '92': ['토스뱅크','Toss Bank'],
};

export function VirtualAccountPanel({ account, amount, locale, orderId, onCheck, checking, providerUnavailable }: {
  account: NonNullable<PaymentInfo['virtualAccount']>; amount: number; locale: SupportedLocale; orderId?: string | null;
  onCheck?: () => void | Promise<unknown>; checking: boolean; providerUnavailable: boolean;
}) {
  const labels = copy[locale];
  const recovery = getPaymentRecoveryCopy(locale);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState(false);
  const expired = useServerTimeReached(Date.parse(account.dueDate));
  async function close() {
    setClosing(true);
    setError(false);
    try {
      await apiClient.post('/api/v1/payments/virtual-account/close', { orderId }, { showErrorToast: false });
      await onCheck?.();
      setConfirmClose(false);
    } catch { setError(true); } finally { setClosing(false); }
  }
  const rows = [
    [labels.bank, banks[account.bankCode]?.[locale === 'ko' ? 0 : 1] ?? account.bankCode],
    [labels.account, account.accountNumber],
    [labels.amount, new Intl.NumberFormat(locale, { style: 'currency', currency: 'KRW' }).format(amount)],
    [labels.due, formatEventTimeWithKstAnchor(account.dueDate, locale, { includeLocalTime: false }).kst],
  ];
  return <section className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5">
    <h2 className="text-lg font-semibold">{labels.title}</h2>
    <p className="text-sm">{expired ? labels.elapsed : labels.body}</p>
    <dl className="space-y-2">{rows.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-sm text-muted-foreground">{label}</dt><dd className="select-all font-medium tabular-nums">{value}</dd>
    </div>)}</dl>
    {(error || providerUnavailable) && <p role="alert">{recovery.providerUnavailable}</p>}
    {confirmClose && <p>{labels.confirm}</p>}
    <div className="flex flex-wrap gap-2">
      {confirmClose ? <><Button disabled={closing} onClick={() => void close()}>{labels.yes}</Button>
        <Button variant="outline" disabled={closing} onClick={() => setConfirmClose(false)}>{labels.back}</Button></>
        : <><Button disabled={checking || !onCheck} onClick={() => void onCheck?.()}>{checking ? recovery.checking : recovery.check}</Button>
          {orderId && !expired && <Button variant="outline" onClick={() => setConfirmClose(true)}>{labels.close}</Button>}</>}
    </div>
  </section>;
}
