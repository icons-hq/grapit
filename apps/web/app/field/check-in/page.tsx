'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { hasAdminCapability } from '@grabit/shared';
import { AlertTriangle, Loader2, ScanLine } from 'lucide-react';
import { ScannerCheckIn } from '@/components/field/scanner-check-in';
import {
  useFieldCheckInConsume,
  useFieldCheckInVerify,
} from '@/hooks/use-field-operations';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/use-auth-store';

const FALLBACK_SHOWTIME_ID = '00000000-0000-4000-8000-000000000000';

export default function FieldCheckInPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isInitialized, accessToken, user } = useAuthStore();
  const ticketToken = searchParams.get('ticket') ?? searchParams.get('token') ?? '';
  const showtimeId = searchParams.get('showtimeId') ?? undefined;
  const returnTarget = useMemo(() => {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
  }, [pathname, searchParams]);
  const hasScannerAccess =
    hasAdminCapability(user, 'field.scan.verify') ||
    hasAdminCapability(user, 'field.scan.consume');
  const deviceAttemptId = useMemo(() => createDeviceAttemptId(), []);

  useEffect(() => {
    if (!isInitialized || accessToken) {
      return;
    }
    router.replace(`/auth?returnTo=${encodeURIComponent(returnTarget)}`);
  }, [accessToken, isInitialized, returnTarget, router]);

  const verifyQuery = useFieldCheckInVerify({
    token: ticketToken,
    showtimeId,
    enabled: isInitialized && Boolean(accessToken) && hasScannerAccess && ticketToken.length > 0,
  });
  const consumeMutation = useFieldCheckInConsume();

  if (!isInitialized || (!accessToken && isInitialized)) {
    return <ScannerLoading message="검표 세션을 확인하고 있습니다" />;
  }

  if (!ticketToken) {
    return (
      <ScannerNotice
        tone="error"
        title="확인할 QR 티켓이 없습니다"
        description="QR 티켓을 다시 스캔하거나 현장 운영자에게 문의하세요."
      />
    );
  }

  if (!hasScannerAccess) {
    return (
      <ScannerCheckIn
        user={user}
        onProcessEntry={() => undefined}
        onSyncOffline={() => undefined}
      />
    );
  }

  if (verifyQuery.isLoading || verifyQuery.isFetching) {
    return <ScannerLoading message="QR 티켓을 확인하고 있습니다" />;
  }

  if (verifyQuery.isError) {
    return (
      <ScannerNotice
        tone="error"
        title="QR 티켓을 확인할 수 없습니다"
        description="네트워크 상태를 확인한 뒤 다시 스캔하세요."
      />
    );
  }

  return (
    <ScannerCheckIn
      user={user}
      verification={verifyQuery.data ?? null}
      consumeResult={consumeMutation.data ?? null}
      isConsuming={consumeMutation.isPending}
      onProcessEntry={() => {
        if (!verifyQuery.data) {
          return;
        }
        consumeMutation.mutate({
          token: ticketToken,
          showtimeId: verifyQuery.data.showtimeId ?? showtimeId ?? FALLBACK_SHOWTIME_ID,
          deviceAttemptId,
          confirmed: true,
        });
      }}
      onSyncOffline={() => undefined}
    />
  );
}

function ScannerLoading({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">
      <Card className="w-full border-gray-200 bg-white shadow-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <Loader2 className="h-5 w-5 animate-spin text-[#6C3CE0]" />
          <p className="text-base font-semibold text-gray-800">{message}</p>
        </CardContent>
      </Card>
    </main>
  );
}

function ScannerNotice({
  tone,
  title,
  description,
}: {
  tone: 'error' | 'neutral';
  title: string;
  description: string;
}) {
  const iconClass = tone === 'error' ? 'text-[#C62828]' : 'text-[#6C3CE0]';
  const Icon = tone === 'error' ? AlertTriangle : ScanLine;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">
      <Card className="w-full border-gray-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${iconClass}`} />
            <div>
              <h1 className="text-heading font-semibold text-gray-900">{title}</h1>
              <p className="mt-2 text-base leading-[1.5] text-gray-700">
                {description}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => window.location.reload()}
          >
            다시 확인
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function createDeviceAttemptId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
