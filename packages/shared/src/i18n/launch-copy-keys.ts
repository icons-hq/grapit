export const LAUNCH_COPY_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;

export const LAUNCH_COPY_NAMESPACES = [
  'nav',
  'home',
  'search',
  'performance',
  'booking',
  'auth.form',
  'auth.consent',
  'auth.emailVerification',
  'auth.otp',
  'auth.errors',
  'sms.otp',
] as const;

export type LaunchCopyLocale = (typeof LAUNCH_COPY_LOCALES)[number];
export type LaunchCopyNamespace = (typeof LAUNCH_COPY_NAMESPACES)[number];

const navKeys = [
  'searchPlaceholder',
  'searchAriaLabel',
  'clearSearch',
  'moreGenres',
  'loginSignup',
  'mypage',
  'logout',
  'language',
  'category',
] as const;

const homeKeys = ['hot', 'newOpen', 'genreShortcuts', 'more', 'empty'] as const;

const searchKeys = [
  'promptTitle',
  'promptBody',
  'resultTitle',
  'totalCount',
  'includeEnded',
  'loadError',
  'retry',
  'emptyHeading',
  'emptyBody',
] as const;

const performanceKeys = [
  'posterAltSuffix',
  'detailTab',
  'salesTab',
  'noDetail',
  'refundTitle',
  'refundItems',
  'loadError',
  'retry',
  'bookCta',
] as const;

const bookingKeys = ['disabled'] as const;

const authFormKeys = [
  'email',
  'password',
  'emailPlaceholder',
  'passwordPlaceholder',
  'passwordDescription',
  'passwordConfirm',
  'passwordConfirmPlaceholder',
  'loginButton',
  'loginLoading',
  'nextButton',
  'forgotPassword',
  'separator',
  'signupComplete',
  'under14Blocked',
  'temporaryError',
] as const;

const authConsentKeys = [
  'selectAll',
  'required',
  'optional',
  'view',
  'previous',
  'next',
  'dialogDescriptionSuffix',
] as const;

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
  'destinationPreview',
  'sentTo',
  'resendSuccessTo',
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
  nav: forLaunchLocales(navKeys),
  home: forLaunchLocales(homeKeys),
  search: forLaunchLocales(searchKeys),
  performance: forLaunchLocales(performanceKeys),
  booking: forLaunchLocales(bookingKeys),
  'auth.form': forLaunchLocales(authFormKeys),
  'auth.consent': forLaunchLocales(authConsentKeys),
  'auth.emailVerification': forLaunchLocales(authEmailVerificationKeys),
  'auth.otp': forLaunchLocales(authOtpKeys),
  'auth.errors': forLaunchLocales(authErrorKeys),
  'sms.otp': forLaunchLocales(smsOtpKeys),
} as const satisfies Record<
  LaunchCopyNamespace,
  Record<LaunchCopyLocale, readonly string[]>
>;
