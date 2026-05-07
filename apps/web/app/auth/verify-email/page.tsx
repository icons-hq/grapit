'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { EmailVerificationStatus } from '@/components/auth/email-verification-status';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px] space-y-6">
        <h1 className="text-center text-heading font-semibold text-gray-900">
          이메일 인증
        </h1>
        {token ? (
          <EmailVerificationStatus email="" token={token} />
        ) : (
          <EmailVerificationStatus email="" initialState="systemError" />
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
