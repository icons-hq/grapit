export const AUTH_COOKIE_NAME = 'refreshToken';
export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY_DAYS = 7;
export const SMS_CODE_LENGTH = 6;
export const SMS_CODE_EXPIRY_SECONDS = 180;
export const SMS_RESEND_COOLDOWN_SECONDS = 30; // D-11: 서버 {sms:{e164}}:resend PX 30000과 동일
export const PASSWORD_MIN_LENGTH = 8;

// Catalog constants
export const PERFORMANCES_PER_PAGE = 20;
export const ADMIN_PERFORMANCES_PER_PAGE = 20;
export const MAX_POSTER_SIZE_MB = 5;
export const MAX_SVG_SIZE_MB = 10;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const CLOSING_SOON_DAYS = 7;

export * from './locales';
