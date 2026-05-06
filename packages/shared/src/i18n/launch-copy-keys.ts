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
  'expired',
  'resendCta',
  'resendLoading',
  'resendSuccess',
  'sent',
  'verified',
] as const;

const authOtpKeys = ['sendCta', 'sending', 'verifyCta', 'verified'] as const;

const authErrorKeys = [
  'expiredOtp',
  'generic',
  'invalidOtp',
  'rateLimited',
  'unsupportedCountry',
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
