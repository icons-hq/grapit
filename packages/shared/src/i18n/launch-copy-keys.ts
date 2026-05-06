export const LAUNCH_COPY_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;

export const LAUNCH_COPY_NAMESPACES = [
  'auth.emailVerification',
  'auth.otp',
  'auth.errors',
  'sms.otp',
] as const;

export type LaunchCopyLocale = (typeof LAUNCH_COPY_LOCALES)[number];
export type LaunchCopyNamespace = (typeof LAUNCH_COPY_NAMESPACES)[number];

const authEmailVerificationKeys = [
  'sent',
  'resendCta',
  'resendLoading',
  'resendSuccess',
  'expired',
  'verified',
  'throttled',
  'systemError',
] as const;

const authOtpKeys = [
  'sent',
  'resendCta',
  'resendLoading',
  'resendSuccess',
  'expired',
  'invalidCode',
  'throttled',
  'systemError',
] as const;

const authErrorKeys = [
  'invalidCredentials',
  'emailUnverified',
  'verificationRequired',
  'providerUnavailable',
  'deviceLimitNotice',
] as const;

const smsOtpKeys = ['message', 'rateLimited', 'verified'] as const;

function forLaunchLocales<const T extends readonly string[]>(keys: T) {
  return {
    ko: keys,
    en: keys,
    th: keys,
    'zh-CN': keys,
    'zh-TW': keys,
  } as const satisfies Record<LaunchCopyLocale, T>;
}

export const LAUNCH_COPY_KEYS = {
  'auth.emailVerification': forLaunchLocales(authEmailVerificationKeys),
  'auth.otp': forLaunchLocales(authOtpKeys),
  'auth.errors': forLaunchLocales(authErrorKeys),
  'sms.otp': forLaunchLocales(smsOtpKeys),
} as const satisfies Record<
  LaunchCopyNamespace,
  Record<LaunchCopyLocale, readonly string[]>
>;
