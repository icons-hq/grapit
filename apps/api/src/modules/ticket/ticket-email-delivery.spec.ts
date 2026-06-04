import { describe, expect, it } from 'vitest';
import { resolveTicketEmailDelivery } from './ticket-email-delivery.js';

describe('resolveTicketEmailDelivery', () => {
  it('blocks social placeholder emails even when the account is marked email-verified', () => {
    expect(
      resolveTicketEmailDelivery({
        email: 'kakao_123@social.grabit.com',
        isEmailVerified: true,
        scheduledAt: '2026-07-17T10:00:00.000Z',
        lastSentAt: null,
      }),
    ).toEqual({
      email: 'kakao_123@social.grabit.com',
      isEmailVerified: true,
      isPlaceholderEmail: true,
      canSend: false,
      status: 'verification_required',
      scheduledAt: '2026-07-17T10:00:00.000Z',
      lastSentAt: null,
    });
  });

  it('marks a verified real email as sent when any QR ticket was emailed', () => {
    expect(
      resolveTicketEmailDelivery({
        email: 'buyer@example.com',
        isEmailVerified: true,
        scheduledAt: '2026-07-17T10:00:00.000Z',
        lastSentAt: '2026-07-17T10:02:00.000Z',
      }),
    ).toMatchObject({
      canSend: true,
      isPlaceholderEmail: false,
      status: 'sent',
    });
  });
});
