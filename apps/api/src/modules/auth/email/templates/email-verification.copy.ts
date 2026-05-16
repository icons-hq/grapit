export const EMAIL_VERIFICATION_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;

export type EmailVerificationLocale = (typeof EMAIL_VERIFICATION_LOCALES)[number];

export type EmailVerificationCopy = {
  subject: string;
  bodyIntro: string;
  codeHelp: string;
  resendCta: string;
  resendLoading: string;
  resendSuccess: string;
  expired: string;
  verified: string;
  throttled: string;
  systemError: string;
};

export const emailVerificationCopy: Record<EmailVerificationLocale, EmailVerificationCopy> = {
  ko: {
    subject: '[Grabit] 이메일 인증 안내',
    bodyIntro: '아래 6자리 인증번호를 Grabit 이메일 인증 화면에 입력해주세요. 이 인증번호는 30분 동안만 유효합니다.',
    codeHelp: '본인이 요청하지 않았다면 이 메일을 무시해주세요.',
    resendCta: '인증번호 다시 보내기',
    resendLoading: '다시 보내는 중...',
    resendSuccess: '인증번호를 다시 보냈습니다',
    expired: '인증번호가 만료되었습니다. 새 인증 메일을 요청해주세요.',
    verified: '이메일 인증이 완료되었습니다.',
    throttled: '잠시 후 다시 시도해주세요.',
    systemError: '일시적인 오류가 발생했습니다. 다시 시도해주세요.',
  },
  en: {
    subject: '[Grabit] Verify your email',
    bodyIntro: 'Enter the 6-digit verification code below on the Grabit email verification screen. This code is valid for 30 minutes.',
    codeHelp: 'If you did not request this code, you can ignore this email.',
    resendCta: 'Resend verification code',
    resendLoading: 'Resending...',
    resendSuccess: 'Verification code sent again',
    expired: 'This verification code has expired. Please request a new email.',
    verified: 'Your email has been verified.',
    throttled: 'Please try again shortly.',
    systemError: 'Something went wrong. Please try again.',
  },
  th: {
    subject: '[Grabit] ยืนยันอีเมลของคุณ',
    bodyIntro: 'กรอกรหัสยืนยัน 6 หลักด้านล่างในหน้าการยืนยันอีเมลของ Grabit รหัสนี้ใช้ได้ 30 นาที',
    codeHelp: 'หากคุณไม่ได้ขอรหัสนี้ คุณสามารถละเว้นอีเมลนี้ได้',
    resendCta: 'ส่งรหัสยืนยันอีกครั้ง',
    resendLoading: 'กำลังส่งอีกครั้ง...',
    resendSuccess: 'ส่งรหัสยืนยันอีกครั้งแล้ว',
    expired: 'รหัสยืนยันหมดอายุแล้ว โปรดขออีเมลใหม่',
    verified: 'ยืนยันอีเมลเรียบร้อยแล้ว',
    throttled: 'โปรดลองอีกครั้งในภายหลัง',
    systemError: 'เกิดข้อผิดพลาดชั่วคราว โปรดลองอีกครั้ง',
  },
  'zh-CN': {
    subject: '[Grabit] 验证邮箱',
    bodyIntro: '请在 Grabit 邮箱验证页面输入下方 6 位验证码。此验证码 30 分钟内有效。',
    codeHelp: '如果不是你本人请求的验证码，可以忽略此邮件。',
    resendCta: '重新发送验证码',
    resendLoading: '正在重新发送...',
    resendSuccess: '验证码已重新发送',
    expired: '验证码已过期。请重新请求验证邮件。',
    verified: '邮箱验证已完成。',
    throttled: '请稍后再试。',
    systemError: '暂时发生错误。请重试。',
  },
  'zh-TW': {
    subject: '[Grabit] 驗證電子郵件',
    bodyIntro: '請在 Grabit 電子郵件驗證頁面輸入下方 6 位數驗證碼。此驗證碼 30 分鐘內有效。',
    codeHelp: '如果不是你本人要求的驗證碼，可以忽略此郵件。',
    resendCta: '重新寄送驗證碼',
    resendLoading: '正在重新寄送...',
    resendSuccess: '驗證碼已重新寄送',
    expired: '驗證碼已過期。請重新申請驗證信。',
    verified: '電子郵件驗證已完成。',
    throttled: '請稍後再試。',
    systemError: '暫時發生錯誤。請再試一次。',
  },
};
