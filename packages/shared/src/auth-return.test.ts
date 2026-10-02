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

  it.each([
    '/.//evil.example', '/..//evil.example', '/%2e//evil.example', '/%2E%2E//evil.example',
    '/a/..//evil.example', '/././/evil.example?next=1', '/booking/../..//evil.example#x',
  ])('rejects a dot-segment path that normalizes into a protocol-relative URL: %s', (target) => {
    expect(resolveAuthReturnTo(target)).toBeNull();
  });

  it.each([
    ['/en/./booking/../mypage?tab=wallet', '/en/mypage?tab=wallet'],
    ['/./support', '/support'],
  ])('returns the normalized same-site path for harmless dot segments: %s', (target, expected) => {
    expect(resolveAuthReturnTo(target)).toBe(expected);
  });

  it('only returns values that stay unchanged when resolved again', () => {
    for (const target of ['/en/booking/event/confirm?resumeOrderId=GRP-test', '/./support', '/th/performance/event#sales-copy']) {
      const resolved = resolveAuthReturnTo(target);
      expect(resolved).not.toBeNull();
      expect(resolveAuthReturnTo(resolved)).toBe(resolved);
      expect(new URL(resolved!, 'https://heygrabit.com').origin).toBe('https://heygrabit.com');
    }
  });
});
