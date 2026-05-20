export const LAUNCH_COPY_LOCALES = ['ko', 'en', 'th', 'zh-CN'] as const;

export const LAUNCH_COPY_NAMESPACES = [
  'nav',
  'home',
  'search',
  'performance',
  'booking',
  'auth.form',
  'auth.signup',
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
  'emailUnavailable',
] as const;

const authSignupKeys = [
  'progressAriaLabel',
  'stepCredentials',
  'stepConsent',
  'stepAdditional',
  'socialStep',
  'socialTitle',
  'nameLabel',
  'namePlaceholder',
  'genderLabel',
  'genderMale',
  'genderFemale',
  'genderUnspecified',
  'countryLabel',
  'countryKR',
  'countryUS',
  'countryJP',
  'countryCN',
  'countryGB',
  'countryCA',
  'countryAU',
  'countryOTHER',
  'birthDateLabel',
  'birthYearAriaLabel',
  'birthMonthAriaLabel',
  'birthDayAriaLabel',
  'phoneLabel',
  'previousButton',
  'submitButton',
  'submittingButton',
  'nameRequired',
  'nameMax',
  'genderRequired',
  'countryRequired',
  'birthYearInvalid',
  'birthMonthInvalid',
  'birthDayInvalid',
  'phoneInvalid',
  'phoneVerificationRequired',
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
  'codeAriaLabel',
  'codePlaceholder',
  'verifyCta',
  'resendCta',
  'resendLoading',
  'resendSuccess',
  'expired',
  'invalidCode',
  'verified',
  'throttled',
  'systemError',
] as const;

const authOtpKeys = [
  'sent',
  'sendCta',
  'sendLoading',
  'resendCta',
  'resendLoading',
  'resendSuccess',
  'destinationPreview',
  'sentTo',
  'resendSuccessTo',
  'cooldownLabel',
  'cooldownAriaLabel',
  'codeAriaLabel',
  'codePlaceholder',
  'verifyCta',
  'expired',
  'invalidCode',
  'throttled',
  'systemError',
  'invalidPhone',
  'smsCapablePhoneRequired',
  'recipientBlocked',
  'providerRateLimited',
  'sendFailed',
  'verified',
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
  } as const satisfies Record<LaunchCopyLocale, T>;
}

export const LAUNCH_COPY_KEYS = {
  nav: forLaunchLocales(navKeys),
  home: forLaunchLocales(homeKeys),
  search: forLaunchLocales(searchKeys),
  performance: forLaunchLocales(performanceKeys),
  booking: forLaunchLocales(bookingKeys),
  'auth.form': forLaunchLocales(authFormKeys),
  'auth.signup': forLaunchLocales(authSignupKeys),
  'auth.consent': forLaunchLocales(authConsentKeys),
  'auth.emailVerification': forLaunchLocales(authEmailVerificationKeys),
  'auth.otp': forLaunchLocales(authOtpKeys),
  'auth.errors': forLaunchLocales(authErrorKeys),
  'sms.otp': forLaunchLocales(smsOtpKeys),
} as const satisfies Record<
  LaunchCopyNamespace,
  Record<LaunchCopyLocale, readonly string[]>
>;
