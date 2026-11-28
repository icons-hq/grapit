import type { AddonRefundReceipt, SupportedLocale } from '@grabit/shared';

const refundCopy = {
  ko: { changed: '환불 내역이 변경되었습니다. 새 예상 금액을 확인해주세요.', method: '각 결제에 사용한 결제수단으로 환불', total: '총 예상 환불액', confirmedTotal: '전체 환불 완료', confirm: '{amount} 환불받고 예매 전체 취소', ticket: '티켓 결제', charges: '결제 건별 환불', addon: '추가 구매', checking: '환불 금액 확인 중' },
  en: { changed: 'Your refund details changed. Please review the new estimate.', method: 'Refunded to each original payment method', total: 'Total estimated refund', confirmedTotal: 'All refunds completed', confirm: 'Cancel booking for {amount}', ticket: 'Ticket payment', charges: 'Refunds by payment', addon: 'Additional purchase', checking: 'Checking refund amount' },
  th: { changed: 'ข้อมูลการคืนเงินเปลี่ยนแปลง โปรดตรวจสอบยอดใหม่', method: 'คืนเงินตามวิธีชำระเงินเดิมของแต่ละรายการ', total: 'ยอดเงินคืนโดยประมาณทั้งหมด', confirmedTotal: 'คืนเงินครบทุกรายการแล้ว', confirm: 'ยกเลิกการจองทั้งหมดและรับเงินคืน {amount}', ticket: 'ค่าบัตร', charges: 'การคืนเงินแต่ละรายการชำระ', addon: 'รายการที่ซื้อเพิ่ม', checking: 'กำลังตรวจสอบยอดคืน' },
  'zh-CN': { changed: '退款明细已变更，请重新确认预计退款金额。', method: '各笔款项原路退回', total: '预计退款总额', confirmedTotal: '全部退款已完成', confirm: '取消整笔预订并退款 {amount}', ticket: '门票支付', charges: '各笔支付退款明细', addon: '追加购买', checking: '正在确认退款金额' },
};
export const getBuyerRefundCopy = (locale: SupportedLocale) => refundCopy[locale];

export function refundProductLabel(products: AddonRefundReceipt['products'], locale: SupportedLocale) {
  return products.map(({ displayCopy, quantity }) => `${(displayCopy[locale] ?? displayCopy.en).name} × ${quantity}`).join(' · ')
    || refundCopy[locale].addon;
}

const copy = {
  ko: { back: '예매 상세로', title: '애드온 추가 구매', history: '애드온 결제 내역', empty: '지금 이 티켓에 추가할 수 있는 애드온이 없습니다.', qty: '구매 수량', next: '결제하기', loading: '재고 확인 중…', retry: '다시 조회', pending: '결제 이어보기', paid: '결제 완료', refunded: '환불 완료', refunding: '환불 처리 중', failed: '환불 문의 필요', cancelled: '결제 취소', refundNotice: '추가 구매한 애드온은 원래 티켓 예매를 전체 취소하면 같은 취소 규정에 따라 별도 결제 건으로 환불됩니다.', separateRefund: '아래 견적은 티켓 예매 결제 건의 금액입니다. 추가 구매한 애드온의 환불 금액은 해당 결제 건에서 별도로 처리됩니다.' },
  en: { back: 'Back to my booking', title: 'Buy ticket add-ons', history: 'Add-on payments', empty: 'No add-ons are available for this ticket.', qty: 'Quantity', next: 'Checkout', loading: 'Checking availability…', retry: 'Retry', pending: 'View pending payment', paid: 'Paid', refunded: 'Refunded', refunding: 'Refund processing', failed: 'Contact support about refund', cancelled: 'Cancelled', refundNotice: 'Add-ons purchased separately are refunded to their original payment under the same cancellation policy when you cancel the entire ticket booking.', separateRefund: 'This estimate covers the ticket payment. Refunds for later add-on purchases are processed on their own payments.' },
  th: { back: 'กลับไปยังรายละเอียดการจอง', title: 'ซื้อสิทธิพิเศษเพิ่ม', history: 'ประวัติการชำระเงินเพิ่มเติม', empty: 'ไม่มีสิทธิพิเศษที่ซื้อเพิ่มได้สำหรับบัตรใบนี้', qty: 'จำนวน', next: 'ชำระเงิน', loading: 'กำลังตรวจสอบจำนวน…', retry: 'ลองอีกครั้ง', pending: 'ดูการชำระเงินที่ค้างอยู่', paid: 'ชำระแล้ว', refunded: 'คืนเงินแล้ว', refunding: 'กำลังคืนเงิน', failed: 'ติดต่อเจ้าหน้าที่เรื่องการคืนเงิน', cancelled: 'ยกเลิกแล้ว', refundNotice: 'เมื่อยกเลิกการจองบัตรทั้งหมด บริการเสริมที่ซื้อภายหลังจะได้รับเงินคืนตามนโยบายเดียวกันผ่านรายการชำระเงินเดิม', separateRefund: 'ยอดนี้เป็นของรายการชำระค่าบัตร ส่วนสิทธิพิเศษที่ซื้อภายหลังจะได้รับเงินคืนแยกต่างหาก' },
  'zh-CN': { back: '返回订单详情', title: '加购附加权益', history: '加购支付记录', empty: '此门票暂无可加购的权益。', qty: '购买数量', next: '去支付', loading: '正在查询库存…', retry: '重试', pending: '查看待支付订单', paid: '已支付', refunded: '已退款', refunding: '退款处理中', failed: '请联系客服处理退款', cancelled: '已取消', refundNotice: '取消整笔门票预订时，后续加购的附加权益按相同取消规则退回其原支付订单。', separateRefund: '此估算仅包含门票订单。后续加购权益的退款将按其支付订单单独处理。' },
};
export const getTicketAddonCopy = (locale: SupportedLocale) => copy[locale];
