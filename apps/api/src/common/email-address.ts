const SOCIAL_PLACEHOLDER_DOMAIN = 'social.grabit.com';

export function isSocialPlaceholderEmail(email: string): boolean {
  const [, domain = ''] = email.trim().toLowerCase().split('@');
  return domain === SOCIAL_PLACEHOLDER_DOMAIN;
}
