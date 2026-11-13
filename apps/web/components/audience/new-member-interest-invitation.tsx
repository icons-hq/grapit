'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AudiencePreferences } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { apiClient } from '@/lib/api-client';
import { InterestInvitation } from './interest-preferences';

/** A home card after signup; never interrupts verification or a booking return. */
export function NewMemberInterestInvitation({ locale }: { locale: string }) {
  const user = useAuthStore((s) => s.user);
  const [now] = useState(Date.now);
  const isNewMember = user?.role === 'user' && now - Date.parse(user.createdAt) < 7 * 86400000;
  return isNewMember ? <InvitationForMember key={user.id} userId={user.id} locale={locale} /> : null;
}
function InvitationForMember({ userId, locale }: { userId: string; locale: string }) {
  const preferences = useQuery({ queryKey: ['audience', 'me', userId],
    queryFn: () => apiClient.get<AudiencePreferences>('/api/v1/analytics/audience/me', { showErrorToast: false }), retry: false, staleTime: 60_000 });
  if (preferences.isError || !preferences.data || preferences.data.consentedAt) return null;
  return <InterestInvitation locale={locale} />;
}
