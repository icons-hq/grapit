import type { SupportedLocale } from '@grabit/shared';

interface QrEmailCopy {
  title: string;
  introduction: (escapedTitle: string) => string;
  reservation: string;
  date: string;
  venue: string;
  link: string;
  codes: (count: number) => string;
}

export const qrEmailCopy: Record<SupportedLocale, QrEmailCopy> = {
  ko: {
    title: 'QR 티켓 안내', introduction: title => `<strong>${title}</strong> 공연의 QR 티켓을 다시 보내드립니다.`,
    reservation: '예매번호', date: '공연일시', venue: '장소', link: '마이페이지에서 좌석별 QR 확인:',
    codes: count => `좌석별 QR 토큰 (${count}매)`,
  },
  en: {
    title: 'Your QR tickets', introduction: title => `Here are your QR tickets for <strong>${title}</strong>.`,
    reservation: 'Booking number', date: 'Show time', venue: 'Venue', link: 'Open My tickets to view the QR code for each seat:',
    codes: count => `QR codes by seat (${count})`,
  },
  th: {
    title: 'บัตร QR ของคุณ', introduction: title => `นี่คือบัตร QR ของคุณสำหรับ <strong>${title}</strong>`,
    reservation: 'หมายเลขการจอง', date: 'วันและเวลาแสดง', venue: 'สถานที่', link: 'เปิดบัตรของฉันเพื่อดู QR ของแต่ละที่นั่ง',
    codes: count => `รหัส QR แยกตามที่นั่ง (${count} ใบ)`,
  },
  'zh-CN': {
    title: '您的二维码门票', introduction: title => `这是您预订的 <strong>${title}</strong> 的二维码门票。`,
    reservation: '订单号', date: '演出时间', venue: '场馆', link: '打开“我的票夹”查看每个座位的二维码：',
    codes: count => `各座位二维码（共 ${count} 张）`,
  },
};
