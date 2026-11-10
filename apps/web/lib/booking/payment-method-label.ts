import type { VisibleCopy } from '@/lib/i18n/visible-copy';

export function formatPaymentMethodLabel(
  method: string | null | undefined,
  labels: VisibleCopy['reservation']['detail']['paymentMethods'],
): string {
  switch (method) {
    case 'CARD': return labels.card;
    case 'VIRTUAL_ACCOUNT': return labels.virtualAccount;
    case 'TRANSFER': return labels.transfer;
    case 'MOBILE_PHONE': return labels.mobilePhone;
    case 'FOREIGN_EASY_PAY': return labels.foreignEasyPay;
    case 'SIMPLE_PAY': return labels.simplePay;
    case null:
    case undefined:
    case '': return labels.unselected;
    default: return method;
  }
}
