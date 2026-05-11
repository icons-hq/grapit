export const SMS_COPY_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'ja'] as const;

export type SmsCopyLocale = (typeof SMS_COPY_LOCALES)[number];

type SmsOtpCopy = {
  template: string;
  sent: string;
  resendCta: string;
  resendLoading: string;
  resendSuccess: string;
  expired: string;
  invalidCode: string;
  throttled: string;
  systemError: string;
};

type AuthStatusCopy = {
  invalidCredentials: string;
  emailUnverified: string;
  verificationRequired: string;
  deviceLimitNotice: string;
  providerUnavailable: string;
};

export const smsOtpCopy: Record<SmsCopyLocale, SmsOtpCopy> = {
  ko: {
    template: '[Grabit] 인증번호 {{otp}} (3분 이내 입력)',
    sent: '인증번호가 발송되었습니다',
    resendCta: '인증번호 재발송',
    resendLoading: '인증번호를 다시 보내는 중입니다',
    resendSuccess: '인증번호를 다시 보냈습니다',
    expired: '인증번호가 만료되었습니다. 재발송해주세요',
    invalidCode: '인증번호가 일치하지 않습니다',
    throttled: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요',
    systemError: '인증번호 처리에 실패했습니다. 잠시 후 다시 시도해주세요',
  },
  en: {
    template: '[Grabit] Verification code {{otp}}. Expires in 3 minutes.',
    sent: 'Verification code sent',
    resendCta: 'Resend code',
    resendLoading: 'Sending a new code',
    resendSuccess: 'A new verification code has been sent',
    expired: 'The verification code expired. Please request a new one.',
    invalidCode: 'The verification code does not match',
    throttled: 'Too many requests. Please try again later.',
    systemError: 'Verification failed. Please try again later.',
  },
  th: {
    template: '[Grabit] รหัสยืนยัน {{otp}} ใช้ได้ภายใน 3 นาที',
    sent: 'ส่งรหัสยืนยันแล้ว',
    resendCta: 'ส่งรหัสอีกครั้ง',
    resendLoading: 'กำลังส่งรหัสใหม่',
    resendSuccess: 'ส่งรหัสยืนยันใหม่แล้ว',
    expired: 'รหัสยืนยันหมดอายุแล้ว โปรดขอรหัสใหม่',
    invalidCode: 'รหัสยืนยันไม่ถูกต้อง',
    throttled: 'มีคำขอมากเกินไป โปรดลองอีกครั้งในภายหลัง',
    systemError: 'ยืนยันรหัสไม่สำเร็จ โปรดลองอีกครั้งในภายหลัง',
  },
  'zh-CN': {
    template: '[Grabit] 验证码 {{otp}}，3分钟内有效。',
    sent: '验证码已发送',
    resendCta: '重新发送验证码',
    resendLoading: '正在重新发送验证码',
    resendSuccess: '新的验证码已发送',
    expired: '验证码已过期，请重新发送。',
    invalidCode: '验证码不正确',
    throttled: '请求过于频繁，请稍后再试。',
    systemError: '验证码处理失败，请稍后再试。',
  },
  ja: {
    template: '[Grabit] 認証コード {{otp}}（3分以内に入力してください）',
    sent: '認証コードを送信しました',
    resendCta: '認証コードを再送信',
    resendLoading: '認証コードを再送信しています',
    resendSuccess: '新しい認証コードを送信しました',
    expired: '認証コードの有効期限が切れました。再送信してください。',
    invalidCode: '認証コードが一致しません',
    throttled: 'リクエストが多すぎます。しばらくしてからもう一度お試しください。',
    systemError: '認証コードの処理に失敗しました。しばらくしてからもう一度お試しください。',
  },
};

export const authStatusCopy: Record<SmsCopyLocale, AuthStatusCopy> = {
  ko: {
    invalidCredentials: '이메일 또는 비밀번호가 올바르지 않습니다',
    emailUnverified: '이메일 인증이 필요합니다',
    verificationRequired: '인증을 완료해주세요',
    deviceLimitNotice: '다른 기기에서 로그인되어 가장 오래된 세션이 종료되었습니다.',
    providerUnavailable: '소셜 로그인 제공자를 사용할 수 없습니다',
  },
  en: {
    invalidCredentials: 'Email or password is incorrect',
    emailUnverified: 'Email verification is required',
    verificationRequired: 'Please complete verification',
    deviceLimitNotice: 'Your oldest session was signed out because another device signed in.',
    providerUnavailable: 'This social login provider is unavailable',
  },
  th: {
    invalidCredentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    emailUnverified: 'ต้องยืนยันอีเมลก่อน',
    verificationRequired: 'โปรดยืนยันให้เสร็จสมบูรณ์',
    deviceLimitNotice: 'เซสชันที่เก่าที่สุดถูกออกจากระบบเพราะมีการเข้าสู่ระบบจากอุปกรณ์อื่น',
    providerUnavailable: 'ผู้ให้บริการเข้าสู่ระบบนี้ไม่พร้อมใช้งาน',
  },
  'zh-CN': {
    invalidCredentials: '邮箱或密码不正确',
    emailUnverified: '需要完成邮箱验证',
    verificationRequired: '请完成验证',
    deviceLimitNotice: '由于另一台设备登录，最早的会话已被退出。',
    providerUnavailable: '该社交登录服务暂不可用',
  },
  ja: {
    invalidCredentials: 'メールアドレスまたはパスワードが正しくありません',
    emailUnverified: 'メール認証が必要です',
    verificationRequired: '認証を完了してください',
    deviceLimitNotice: '別の端末でログインしたため、最も古いセッションが終了しました。',
    providerUnavailable: 'このソーシャルログインは現在利用できません',
  },
};

export function formatSmsOtpMessage(otp: string, locale: SmsCopyLocale = 'ko'): string {
  return smsOtpCopy[locale].template.replace('{{otp}}', otp);
}
