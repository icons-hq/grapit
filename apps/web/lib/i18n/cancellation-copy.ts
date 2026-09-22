const copies = {
  ko: {
    resalePending: "취소 확정 후 재판매 시각이 정해집니다.",
    selectionNotice: "아래에 표시된 좌석만 취소됩니다. 남는 티켓은 계속 사용할 수 있습니다.", confirmTitle: "선택한 좌석을 취소하시겠습니까?", confirmSelected: "선택한 좌석 취소",
    completedTotal: '결제사 환불 완료 합계', held: '좌석 재판매 대기', released: '좌석 재판매 가능', checkCancellation: '취소 상태 확인', selected: '취소할 좌석', remaining: '남는 유효 티켓', none: '없음', cancelOne: '이 좌석 취소',
    providerRefund: '결제사 환불액', retainedFee: '환불되지 않는 예매 수수료', retry: '견적 다시 확인',
    requested: '취소 요청을 접수했습니다. 갱신된 티켓 상태를 확인해주세요.',
    unknown: '취소 결과를 확인하지 못했습니다. 예매 상태를 새로고침한 뒤 다시 확인해주세요.',
    policy: '적용 취소 정책', policies: ['예매 당일 취소', '예매 후 7일 이내', '예매 후 8일 이후 · 공연 10일 전까지', '공연 9~7일 전', '공연 6~3일 전', '공연 2~1일 전', '운영자 전액 환불'],
  },
  en: {
    resalePending: "Resale timing is set after cancellation is confirmed.",
    selectionNotice: "Only the seats listed below will be cancelled. Your remaining tickets stay valid.", confirmTitle: "Cancel the selected seats?", confirmSelected: "Cancel selected seats",
    completedTotal: 'Total refunded by payment provider', held: 'Seat held before resale', released: 'Seat released for resale', checkCancellation: 'Check cancellation status', selected: 'Seats to cancel', remaining: 'Tickets you will keep', none: 'None', cancelOne: 'Cancel this seat',
    providerRefund: 'Payment provider refund', retainedFee: 'Non-refundable booking fees', retry: 'Refresh refund quote',
    requested: 'Cancellation requested. Check the updated ticket status.',
    unknown: 'The cancellation result is not confirmed. Refresh your booking to check its status.',
    policy: 'Cancellation policy', policies: ['Cancellation on booking day', 'Within 7 days of booking', 'After 7 days of booking, at least 10 days before the show', '9–7 days before the show', '6–3 days before the show', '2–1 days before the show', 'Operator full refund'],
  },
  th: {
    resalePending: "กำหนดเวลาเปิดขายอีกครั้งหลังยืนยันการยกเลิก",
    selectionNotice: "ยกเลิกเฉพาะที่นั่งที่ระบุด้านล่าง บัตรที่เหลือยังใช้ได้", confirmTitle: "ยกเลิกที่นั่งที่เลือกหรือไม่", confirmSelected: "ยกเลิกที่นั่งที่เลือก",
    completedTotal: 'ยอดคืนสำเร็จจากผู้ให้บริการชำระเงิน', held: 'ที่นั่งรอเปิดขายอีกครั้ง', released: 'เปิดขายที่นั่งอีกครั้งแล้ว', checkCancellation: 'ตรวจสอบสถานะการยกเลิก', selected: 'ที่นั่งที่จะยกเลิก', remaining: 'บัตรที่ยังใช้งานได้', none: 'ไม่มี', cancelOne: 'ยกเลิกที่นั่งนี้',
    providerRefund: 'ยอดคืนจากผู้ให้บริการชำระเงิน', retainedFee: 'ค่าธรรมเนียมการจองที่ไม่คืน', retry: 'ตรวจสอบยอดคืนอีกครั้ง',
    requested: 'รับคำขอยกเลิกแล้ว โปรดตรวจสอบสถานะบัตรล่าสุด',
    unknown: 'ยังยืนยันผลการยกเลิกไม่ได้ โปรดรีเฟรชการจองเพื่อตรวจสอบสถานะ',
    policy: 'นโยบายการยกเลิก', policies: ['ยกเลิกในวันจอง', 'ภายใน 7 วันหลังจอง', 'เกิน 7 วันหลังจอง และก่อนการแสดงอย่างน้อย 10 วัน', 'ก่อนการแสดง 9–7 วัน', 'ก่อนการแสดง 6–3 วัน', 'ก่อนการแสดง 2–1 วัน', 'คืนเงินเต็มจำนวนโดยผู้ดูแล'],
  },
  'zh-CN': {
    resalePending: "取消确认后确定重新出售时间。",
    selectionNotice: "仅取消下列座位，其余票券仍然有效。", confirmTitle: "要取消所选座位吗？", confirmSelected: "取消所选座位",
    completedTotal: '支付机构已退款合计', held: '座位等待重新出售', released: '座位已可重新出售', checkCancellation: '查询取消状态', selected: '要取消的座位', remaining: '保留的有效票券', none: '无', cancelOne: '取消此座位',
    providerRefund: '支付机构退款金额', retainedFee: '不予退还的预订手续费', retry: '重新确认退款金额',
    requested: '已收到取消申请，请查看更新后的票券状态。',
    unknown: '尚未确认取消结果，请刷新预订以查看状态。',
    policy: '适用取消政策', policies: ['预订当天取消', '预订后7天内', '预订超过7天，且距演出至少10天', '演出前9至7天', '演出前6至3天', '演出前2至1天', '运营人员全额退款'],
  },
};

export function getCancellationCopy(locale: string) {
  return copies[locale as keyof typeof copies] ?? copies.ko;
}

export function getCancellationPolicyLabel(code: string, locale: string): string {
  const index = ['SAME_DAY_BEFORE_MIDNIGHT', 'WITHIN_7_DAYS_AFTER_BOOKING', 'BOOKING_DAY_8_TO_SHOW_DAY_10',
    'SHOW_DAY_9_TO_7', 'SHOW_DAY_6_TO_3', 'SHOW_DAY_2_TO_1', 'ADMIN_FULL_REFUND_OVERRIDE'].indexOf(code);
  return getCancellationCopy(locale).policies[index] ?? '';
}
