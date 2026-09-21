import { describe, expect, it } from 'vitest';
import { resolveAuthReturnTo } from './auth-return';

describe('Authentication return destination', () => {
  it.each([
    '/en/booking/event/confirm?resumeOrderId=GRP-test',
    '/th/performance/event#sales-copy', '/zh-CN/mypage?tab=wallet', '/support',
  ])('preserves a same-site customer destination: %s', (target) => {
    expect(resolveAuthReturnTo(target)).toBe(target);
  });

  it.each([
    'https://outside.test', '//outside.test', '/\\outside.test',
    '/auth', '/en/auth/verify-email', '/th/../auth/callback',
    '/en/%61uth', '/%2f%2foutside.test', '/en/auth%2fcallback',
    '/mypage?accessToken=secret', '/mypage?password=secret', '/field/check-in?token=qr-secret',
    '/mypage\n', '/mypage%0a',
  ])('rejects an external, recursive or credential-bearing destination: %s', (target) => {
    expect(resolveAuthReturnTo(target)).toBeNull();
  });
});
