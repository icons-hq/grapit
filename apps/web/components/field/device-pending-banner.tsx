'use client';

import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FieldDevicePendingGroup } from '@/hooks/use-field-offline-queue';
import { formatFieldShowtimeKst } from '@/lib/field/showtime-format';

interface ShowtimeLabel {
  title: string;
  dateTime: string;
}

interface DevicePendingBannerProps {
  groups: readonly FieldDevicePendingGroup[];
  currentUserId: string | undefined;
  currentShowtimeId: string;
  /**
   * Every unsynced entry of the signed-in account, current showtime included.
   * The sync button sends all of them, so its count must not leave any out.
   */
  ownPendingCount: number;
  canSync: boolean;
  isSyncing: boolean;
  describeShowtime: (showtimeId: string) => ShowtimeLabel | null;
  onSelectShowtime: (showtimeId: string) => void;
  onSync: () => void;
}

/**
 * Unsynced entries saved for another showtime or another account would be
 * invisible in the per-showtime list. This banner keeps every one of them on
 * screen until it is synced.
 */
export function DevicePendingBanner({
  groups,
  currentUserId,
  currentShowtimeId,
  ownPendingCount,
  canSync,
  isSyncing,
  describeShowtime,
  onSelectShowtime,
  onSync,
}: DevicePendingBannerProps) {
  const elsewhere = groups.filter(
    (group) => group.scannerUserId !== currentUserId || group.showtimeId !== currentShowtimeId,
  );
  if (elsewhere.length === 0) return null;

  const own = elsewhere.filter((group) => group.scannerUserId === currentUserId);
  const otherAccountsCount = elsewhere
    .filter((group) => group.scannerUserId !== currentUserId)
    .reduce((sum, group) => sum + group.count, 0);
  const total = elsewhere.reduce((sum, group) => sum + group.count, 0);

  return (
    <section
      aria-label="이 기기의 미동기화 입장 대기"
      data-testid="device-pending-banner"
      className="space-y-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 text-[#8B6306]"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-semibold">
            {currentShowtimeId ? '다른 회차·계정의' : '이 기기에'} 동기화되지 않은 입장 대기 {total}건
          </p>
          <p className="mt-1 text-sm leading-[1.45]">
            대기 기록은 서버 확정 입장이 아닙니다. 연결이 복구되면 동기화하고, 기기를 넘기거나
            로그아웃하기 전에 0건인지 확인하세요.
          </p>
        </div>
      </div>

      {own.length > 0 && (
        <ul className="space-y-2">
          {own.map((group) => {
            const showtime = describeShowtime(group.showtimeId);
            return (
              <li
                key={`${group.scannerUserId}:${group.showtimeId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#FDE68A] bg-white px-3 py-2 text-sm font-semibold"
              >
                <span className="min-w-0 break-words">
                  {showtime
                    ? `${showtime.title} · ${formatFieldShowtimeKst(showtime.dateTime)}`
                    : '목록에 없는 회차'}{' '}
                  · {group.count}건
                </span>
                {showtime && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-9 border-[#8B6306] text-[#8B6306]"
                    onClick={() => onSelectShowtime(group.showtimeId)}
                  >
                    이 회차로 이동
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {otherAccountsCount > 0 && (
        <p className="text-sm font-semibold leading-[1.45]">
          다른 현장 계정이 이 기기에 저장한 대기 {otherAccountsCount}건이 있습니다. 그 계정으로 로그인해야
          동기화할 수 있으니 현장 책임자에게 알리세요.
        </p>
      )}

      {ownPendingCount > 0 && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-[#8B6306] text-[#8B6306]"
          disabled={!canSync || isSyncing}
          onClick={onSync}
        >
          <RefreshCcw className="h-4 w-4" />
          {isSyncing ? '동기화 중' : `이 계정 대기 전체 ${ownPendingCount}건 동기화`}
        </Button>
      )}
    </section>
  );
}
