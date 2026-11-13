'use client';
import { AuthGuard } from '@/components/auth/auth-guard';
import { InterestPreferences } from '@/components/audience/interest-preferences';
export default function InterestsPage() {
  return <AuthGuard><main className="mx-auto w-full max-w-3xl px-4 py-8"><InterestPreferences /></main></AuthGuard>;
}
