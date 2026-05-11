export const EMAIL_VERIFICATION_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'ja'] as const;

export type EmailVerificationLocale = (typeof EMAIL_VERIFICATION_LOCALES)[number];

export type EmailVerificationCopy = {
  subject: string;
  bodyIntro: string;
  verifyCta: string;
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
    bodyIntro: '아래 버튼을 눌러 이메일 인증을 완료해주세요. 이 링크는 30분 동안만 유효합니다.',
    verifyCta: '이메일 인증하기',
    resendCta: '인증 메일 다시 보내기',
    resendLoading: '다시 보내는 중...',
    resendSuccess: '인증 메일을 다시 보냈습니다',
    expired: '인증 링크가 만료되었습니다. 새 인증 메일을 요청해주세요.',
    verified: '이메일 인증이 완료되었습니다.',
    throttled: '잠시 후 다시 시도해주세요.',
    systemError: '일시적인 오류가 발생했습니다. 다시 시도해주세요.',
  },
  en: {
    subject: '[Grabit] Verify your email',
    bodyIntro: 'Use the button below to verify your email. This link is valid for 30 minutes.',
    verifyCta: 'Verify email',
    resendCta: 'Resend verification email',
    resendLoading: 'Resending...',
    resendSuccess: 'Verification email sent again',
    expired: 'This verification link has expired. Please request a new email.',
    verified: 'Your email has been verified.',
    throttled: 'Please try again shortly.',
    systemError: 'Something went wrong. Please try again.',
  },
  th: {
    subject: '[Grabit] ยืนยันอีเมลของคุณ',
    bodyIntro: 'กดปุ่มด้านล่างเพื่อยืนยันอีเมล ลิงก์นี้ใช้ได้ 30 นาที',
    verifyCta: 'ยืนยันอีเมล',
    resendCta: 'ส่งอีเมลยืนยันอีกครั้ง',
    resendLoading: 'กำลังส่งอีกครั้ง...',
    resendSuccess: 'ส่งอีเมลยืนยันอีกครั้งแล้ว',
    expired: 'ลิงก์ยืนยันหมดอายุแล้ว โปรดขออีเมลใหม่',
    verified: 'ยืนยันอีเมลเรียบร้อยแล้ว',
    throttled: 'โปรดลองอีกครั้งในภายหลัง',
    systemError: 'เกิดข้อผิดพลาดชั่วคราว โปรดลองอีกครั้ง',
  },
  'zh-CN': {
    subject: '[Grabit] 验证邮箱',
    bodyIntro: '请点击下方按钮完成邮箱验证。此链接 30 分钟内有效。',
    verifyCta: '验证邮箱',
    resendCta: '重新发送验证邮件',
    resendLoading: '正在重新发送...',
    resendSuccess: '验证邮件已重新发送',
    expired: '验证链接已过期。请重新请求验证邮件。',
    verified: '邮箱验证已完成。',
    throttled: '请稍后再试。',
    systemError: '暂时发生错误。请重试。',
  },
  ja: {
    subject: '[Grabit] メール認証のご案内',
    bodyIntro: '下のボタンを押してメール認証を完了してください。このリンクは30分間有効です。',
    verifyCta: 'メールを認証する',
    resendCta: '認証メールを再送信',
    resendLoading: '再送信中...',
    resendSuccess: '認証メールを再送信しました',
    expired: '認証リンクの有効期限が切れました。新しいメールをリクエストしてください。',
    verified: 'メール認証が完了しました。',
    throttled: 'しばらくしてからもう一度お試しください。',
    systemError: '一時的なエラーが発生しました。もう一度お試しください。',
  },
};
