import type { TicketEmailDelivery } from '@grabit/shared';
import { isSocialPlaceholderEmail } from '../../common/email-address.js';

export { isSocialPlaceholderEmail };

export function resolveTicketEmailDelivery(input: {
  email: string;
  isEmailVerified: boolean;
  scheduledAt: string | null;
  lastSentAt: string | null;
  hasActiveTickets?: boolean;
}): TicketEmailDelivery {
  const isPlaceholderEmail = isSocialPlaceholderEmail(input.email);
  const canSend = input.isEmailVerified && !isPlaceholderEmail && input.hasActiveTickets !== false;

  return {
    email: input.email,
    isEmailVerified: input.isEmailVerified,
    isPlaceholderEmail,
    canSend,
    status: canSend ? (input.lastSentAt ? 'sent' : 'ready') : 'verification_required',
    scheduledAt: input.scheduledAt,
    lastSentAt: input.lastSentAt,
  };
}
