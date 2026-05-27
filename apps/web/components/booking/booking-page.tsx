'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  FloorAwareSeatSelection,
  SeatMapConfig,
  SeatState,
} from '@grabit/shared';
import { normalizeSeatIdentity } from '@grabit/shared';
import { usePerformanceDetail } from '@/hooks/use-performances';
import {
  useSeatStatus,
  useMyLocks,
  useLockSeat,
  useUnlockSeat,
  useUnlockAllSeats,
} from '@/hooks/use-booking';
import { useBookingStore } from '@/stores/use-booking-store';
import { useBookingSocket } from '@/hooks/use-socket';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { ApiClientError } from '@/lib/api-client';
import {
  getKstCalendarDate,
  getKstCalendarKey,
  isSameKstCalendarDate,
} from '@/lib/booking-datetime';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BookingHeader } from './booking-header';
import { DatePicker } from './date-picker';
import { FloorSelector } from './floor-selector';
import { ShowtimeChips } from './showtime-chips';
import { SeatLegend } from './seat-legend';
import { SeatMapViewer } from './seat-map-viewer';
import { TimerExpiredModal } from './timer-expired-modal';

type RuntimeSeatState = SeatState | 'disabled';

type RuntimeSeatIdentity = {
  seatId: string;
  floorKey: string;
  seatKey: string;
};

type TierSummary = {
  tierName: string;
  color: string;
  count: number;
};

function parseRuntimeSeatIdentity(rawSeatIdOrKey: string): RuntimeSeatIdentity {
  const identity = normalizeSeatIdentity({ seatId: rawSeatIdOrKey });

  return {
    seatId: identity.seatId,
    floorKey: identity.floorKey,
    seatKey: identity.seatKey,
  };
}

function isUnavailableSeatState(state: RuntimeSeatState | undefined) {
  return state === 'locked' || state === 'sold' || state === 'held' || state === 'disabled';
}

function formatSeatLabel(seat: FloorAwareSeatSelection) {
  return `${seat.floorLabel} ${seat.row}열 ${seat.number}번`;
}

function SelectionTags({
  seats,
  onRemove,
}: {
  seats: FloorAwareSeatSelection[];
  onRemove: (seatKey: string) => void;
}) {
  if (seats.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        선택한 좌석이 없습니다. 좌석을 클릭하면 이곳에 표시됩니다.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {seats.map((seat) => (
        <button
          key={seat.seatKey}
          type="button"
          onClick={() => onRemove(seat.seatKey)}
          aria-label={`${formatSeatLabel(seat)} 선택 해제`}
          className="inline-flex min-h-8 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          style={{ backgroundColor: seat.tierColor ?? '#6C3CE0' }}
        >
          <span>{seat.tierName}</span>
          <span>{formatSeatLabel(seat)}</span>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function BookingSelectionBar({
  tierSummaries,
  selectedSeatCount,
  totalPrice,
  canClear,
  onClear,
  onProceed,
  isLoading,
  disabledReason,
}: {
  tierSummaries: TierSummary[];
  selectedSeatCount: number;
  totalPrice: number;
  canClear: boolean;
  onClear: () => void;
  onProceed: () => void;
  isLoading: boolean;
  disabledReason: string | null;
}) {
  return (
    <aside
      role="complementary"
      aria-label="선택 좌석 요약"
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-border bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3 shadow-[0_-12px_32px_rgba(0,0,0,0.08)] backdrop-blur"
    >
      <div className="mx-auto grid w-full max-w-[1280px] gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {tierSummaries.length > 0 ? (
              tierSummaries.map((summary) => (
                <span
                  key={summary.tierName}
                  className="inline-flex min-h-8 items-center gap-2 rounded-lg bg-[#F5F5F7] px-3 text-gray-800"
                >
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: summary.color }}
                  />
                  <strong>{summary.tierName}</strong>
                  <span>{summary.count}석</span>
                </span>
              ))
            ) : (
              <span className="inline-flex min-h-8 items-center rounded-lg bg-[#F5F5F7] px-3 text-gray-500">
                선택 좌석 0석
              </span>
            )}
            <span className="inline-flex min-h-8 items-center rounded-lg bg-[#F5F5F7] px-3 font-semibold text-gray-800">
              총 {selectedSeatCount}석
            </span>
          </div>
          {disabledReason ? (
            <p className="mt-2 text-sm font-semibold text-amber-800">
              {disabledReason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <p className="text-right text-2xl font-extrabold text-gray-950">
            <small className="mr-2 text-sm font-medium text-gray-500">
              총 결제 금액
            </small>
            {totalPrice.toLocaleString()}원
          </p>
          <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex">
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-4"
              disabled={!canClear || isLoading}
              onClick={onClear}
            >
              전체 해제
            </Button>
            <Button
              className="h-11 min-w-28 px-5 text-base"
              disabled={!!disabledReason || selectedSeatCount === 0 || isLoading}
              onClick={onProceed}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  처리 중...
                </>
              ) : selectedSeatCount === 0 ? '좌석을 선택해주세요' : '다음'}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function BookingPage({ performanceId }: { performanceId: string }) {
  const router = useRouter();
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);
  const { data: performance, isLoading: performanceLoading } =
    usePerformanceDetail(performanceId);

  const {
    selectedDate,
    selectedShowtimeId,
    selectedSeats,
    timerExpiresAt,
    isTimerExpired,
    setDate,
    setShowtime,
    addSeat,
    removeSeat,
    setTimerExpiry,
  } = useBookingStore();

  const [selectedFloorKey, setSelectedFloorKey] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(true);

  useBookingSocket(selectedShowtimeId);

  const { data: seatStatusData } = useSeatStatus(selectedShowtimeId);
  const { data: myLocksData } = useMyLocks(selectedShowtimeId);
  const lockSeat = useLockSeat();
  const unlockSeat = useUnlockSeat();
  const unlockAll = useUnlockAllSeats();
  const { bookingAvailable, bookingDisabledMessage } = useBookingAvailability({
    performanceStatus: performance?.status,
  });
  const bookingDisabledReason = bookingAvailable ? null : bookingDisabledMessage;

  const availableSeatMaps = useMemo(() => {
    if (!performance) {
      return [];
    }

    const performanceSeatMaps = performance.seatMaps ?? [];
    const seatMaps = performanceSeatMaps.length > 0
      ? performanceSeatMaps
      : performance.seatMap
        ? [performance.seatMap]
        : [];

    return [...seatMaps].sort((left, right) => left.sortOrder - right.sortOrder);
  }, [performance]);

  useEffect(() => {
    if (selectedFloorKey && availableSeatMaps.some((seatMap) => seatMap.floorKey === selectedFloorKey)) {
      return;
    }

    setSelectedFloorKey(availableSeatMaps[0]?.floorKey ?? null);
  }, [availableSeatMaps, selectedFloorKey]);

  const currentSeatMap = useMemo(
    () => availableSeatMaps.find((seatMap) => seatMap.floorKey === selectedFloorKey)
      ?? availableSeatMaps[0]
      ?? null,
    [availableSeatMaps, selectedFloorKey],
  );

  const allShowtimes = useMemo(
    () => performance?.showtimes ?? [],
    [performance?.showtimes],
  );

  const availableDates = useMemo(() => {
    const dateMap = new Map<string, Date>();
    for (const showtime of allShowtimes) {
      const key = getKstCalendarKey(showtime.dateTime);
      if (!dateMap.has(key)) {
        dateMap.set(key, getKstCalendarDate(showtime.dateTime));
      }
    }
    return Array.from(dateMap.values());
  }, [allShowtimes]);

  const filteredShowtimes = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    return allShowtimes.filter((showtime) =>
      isSameKstCalendarDate(showtime.dateTime, selectedDate),
    );
  }, [allShowtimes, selectedDate]);

  const tierInfoByFloorKey = useMemo(() => {
    const map = new Map<string, Map<string, { tierName: string; color: string; price: number }>>();
    if (!performance?.priceTiers) {
      return map;
    }

    for (const seatMap of availableSeatMaps) {
      const seatConfig = seatMap.seatConfig;
      if (!seatConfig) {
        map.set(seatMap.floorKey, new Map());
        continue;
      }

      const tierMap = new Map<string, { tierName: string; color: string; price: number }>();
      for (const tier of seatConfig.tiers) {
        const priceTier = performance.priceTiers.find((item) => item.tierName === tier.tierName);
        for (const seatId of tier.seatIds) {
          tierMap.set(seatId, {
            tierName: tier.tierName,
            color: tier.color,
            price: priceTier?.price ?? 0,
          });
        }
      }
      map.set(seatMap.floorKey, tierMap);
    }

    return map;
  }, [availableSeatMaps, performance?.priceTiers]);

  const seatStatesByFloorKey = useMemo(() => {
    const map = new Map<string, Map<string, RuntimeSeatState>>();
    if (!seatStatusData?.seats) {
      return map;
    }

    for (const [runtimeSeatId, state] of Object.entries(seatStatusData.seats)) {
      const seatIdentity = parseRuntimeSeatIdentity(runtimeSeatId);
      const floorMap = map.get(seatIdentity.floorKey) ?? new Map<string, RuntimeSeatState>();
      floorMap.set(seatIdentity.seatKey, state as RuntimeSeatState);
      floorMap.set(seatIdentity.seatId, state as RuntimeSeatState);
      map.set(seatIdentity.floorKey, floorMap);
    }

    return map;
  }, [seatStatusData]);

  const seatStatesMap = useMemo(
    () => currentSeatMap
      ? seatStatesByFloorKey.get(currentSeatMap.floorKey) ?? new Map<string, RuntimeSeatState>()
      : new Map<string, RuntimeSeatState>(),
    [currentSeatMap, seatStatesByFloorKey],
  );

  const selectedSeatIds = useMemo(
    () => new Set(
      selectedSeats
        .filter((seat) => seat.floorKey === currentSeatMap?.floorKey)
        .map((seat) => seat.seatId),
    ),
    [currentSeatMap?.floorKey, selectedSeats],
  );

  const seatConfig: SeatMapConfig | null = currentSeatMap?.seatConfig ?? null;
  const tierInfoMap = useMemo(
    () => (currentSeatMap ? tierInfoByFloorKey.get(currentSeatMap.floorKey) ?? new Map() : new Map()),
    [currentSeatMap, tierInfoByFloorKey],
  );

  const legendTiers = useMemo(() => {
    if (!seatConfig || !performance?.priceTiers) {
      return [];
    }

    return seatConfig.tiers
      .map((tier) => {
        const priceTier = performance.priceTiers.find((item) => item.tierName === tier.tierName);
        return {
          name: tier.tierName,
          color: tier.color,
          price: priceTier?.price ?? 0,
        };
      })
      .sort((left, right) => right.price - left.price);
  }, [seatConfig, performance?.priceTiers]);

  const maxTicketsPerUser = performance?.bookingPolicy?.maxTicketsPerUser ?? 1;
  const ticketLimitCopy = `이 공연은 1인 ${maxTicketsPerUser}매까지 예매할 수 있습니다`;
  const seatChangePolicyCopy = '결제 완료 후 좌석 변경은 지원되지 않으며, 취소/환불 후 다시 예매해야 합니다.';

  const floorOrderMap = useMemo(
    () => new Map(availableSeatMaps.map((seatMap) => [seatMap.floorKey, seatMap.sortOrder])),
    [availableSeatMaps],
  );

  const sortedSelections = useMemo(() => {
    return [...selectedSeats].sort((left, right) => {
      const leftOrder = floorOrderMap.get(left.floorKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = floorOrderMap.get(right.floorKey) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const rowCompare = left.row.localeCompare(right.row, 'ko');
      if (rowCompare !== 0) {
        return rowCompare;
      }

      const leftNumber = Number.parseInt(left.number, 10);
      const rightNumber = Number.parseInt(right.number, 10);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
      }

      return left.number.localeCompare(right.number, 'ko');
    });
  }, [floorOrderMap, selectedSeats]);

  const tierSummaries = useMemo(() => {
    const summaries = new Map<string, TierSummary>();

    for (const seat of sortedSelections) {
      const existing = summaries.get(seat.tierName);
      if (existing) {
        existing.count += 1;
        continue;
      }

      summaries.set(seat.tierName, {
        tierName: seat.tierName,
        color: seat.tierColor ?? '#6C3CE0',
        count: 1,
      });
    }

    return Array.from(summaries.values());
  }, [sortedSelections]);

  const totalPrice = useMemo(
    () => selectedSeats.reduce((sum, seat) => sum + seat.price, 0),
    [selectedSeats],
  );

  const floorOptions = useMemo(() => {
    return availableSeatMaps.map((seatMap) => {
      const selectedCount = selectedSeats.filter((seat) => seat.floorKey === seatMap.floorKey).length;
      const floorStates = seatStatesByFloorKey.get(seatMap.floorKey);
      const seatIds = seatMap.seatConfig?.tiers.flatMap((tier) => tier.seatIds) ?? [];
      const hasAvailableSeats = seatIds.length === 0
        ? true
        : seatIds.some((seatId) => {
          const state = floorStates?.get(seatId) ?? 'available';
          return !isUnavailableSeatState(state);
        });

      return {
        floorKey: seatMap.floorKey,
        floorLabel: seatMap.floorLabel,
        selectedCount,
        isSoldOut: !hasAvailableSeats,
        totalSeats: seatMap.totalSeats,
      };
    });
  }, [availableSeatMaps, seatStatesByFloorKey, selectedSeats]);

  const currentFloorOption = floorOptions.find((option) => option.floorKey === currentSeatMap?.floorKey) ?? null;

  useEffect(() => {
    if (!myLocksData || myLocksData.seatIds.length === 0) {
      return;
    }
    if (selectedSeats.length > 0) {
      return;
    }

    for (const runtimeSeatId of myLocksData.seatIds) {
      const seatIdentity = parseRuntimeSeatIdentity(runtimeSeatId);
      const floorSeatMap = availableSeatMaps.find((seatMap) => seatMap.floorKey === seatIdentity.floorKey);
      const tierInfo = tierInfoByFloorKey.get(seatIdentity.floorKey)?.get(seatIdentity.seatId);
      if (!floorSeatMap || !tierInfo) {
        continue;
      }

      const parts = seatIdentity.seatId.split('-');
      addSeat({
        seatId: seatIdentity.seatId,
        tierName: tierInfo.tierName,
        tierColor: tierInfo.color,
        row: parts[0] ?? seatIdentity.seatId,
        number: parts[1] ?? '',
        price: tierInfo.price,
        floorKey: floorSeatMap.floorKey,
        floorLabel: floorSeatMap.floorLabel,
        seatKey: seatIdentity.seatKey,
      });
    }

    if (myLocksData.expiresAt) {
      setTimerExpiry(myLocksData.expiresAt);
    }
  }, [
    addSeat,
    availableSeatMaps,
    myLocksData,
    selectedSeats.length,
    setTimerExpiry,
    tierInfoByFloorKey,
  ]);

  const handleSeatClick = useCallback(
    (runtimeSeatId: string) => {
      if (!selectedShowtimeId || !currentSeatMap) {
        return;
      }
      if (!bookingAvailable) {
        toast.info(bookingDisabledMessage);
        return;
      }

      const seatIdentity = parseRuntimeSeatIdentity(runtimeSeatId);
      const floorSeatMap = availableSeatMaps.find((seatMap) => seatMap.floorKey === seatIdentity.floorKey)
        ?? currentSeatMap;
      const floorSeatStates = seatStatesByFloorKey.get(floorSeatMap.floorKey) ?? seatStatesMap;
      const seatState = floorSeatStates.get(seatIdentity.seatKey) ?? floorSeatStates.get(seatIdentity.seatId);
      const isSelected = selectedSeats.some(
        (seat) => seat.seatKey === seatIdentity.seatKey
          || (seat.floorKey === floorSeatMap.floorKey && seat.seatId === seatIdentity.seatId),
      );
      if (isUnavailableSeatState(seatState) && !isSelected) {
        toast.info('이미 다른 사용자가 선택한 좌석입니다');
        return;
      }

      const existingSeat = selectedSeats.find(
        (seat) => seat.seatKey === seatIdentity.seatKey
          || (seat.floorKey === floorSeatMap.floorKey && seat.seatId === seatIdentity.seatId),
      );
      if (existingSeat) {
        removeSeat(existingSeat.seatKey);
        unlockSeat.mutate({ showtimeId: selectedShowtimeId, seatId: existingSeat.seatKey });
        return;
      }

      if (selectedSeats.length >= maxTicketsPerUser) {
        toast.error(
          `${ticketLimitCopy}. 다른 좌석을 먼저 해제해주세요.`,
        );
        return;
      }

      const info = tierInfoByFloorKey.get(floorSeatMap.floorKey)?.get(seatIdentity.seatId)
        ?? tierInfoMap.get(seatIdentity.seatId)
        ?? tierInfoMap.get(seatIdentity.seatKey);
      if (!info) {
        return;
      }

      const parts = seatIdentity.seatId.split('-');
      const seatSelection: FloorAwareSeatSelection = {
        seatId: seatIdentity.seatId,
        tierName: info.tierName,
        tierColor: info.color,
        row: parts[0] ?? seatIdentity.seatId,
        number: parts[1] ?? '',
        price: info.price,
        floorKey: floorSeatMap.floorKey,
        floorLabel: floorSeatMap.floorLabel,
        seatKey: seatIdentity.seatKey,
      };

      addSeat(seatSelection);

      lockSeat.mutate(
        {
          showtimeId: selectedShowtimeId,
          seatId: seatIdentity.seatId,
          floorKey: floorSeatMap.floorKey,
          floorLabel: floorSeatMap.floorLabel,
          seatKey: seatSelection.seatKey,
        },
        {
          onSuccess: (response) => {
            if (response.expiresAt) {
              setTimerExpiry(response.expiresAt);
            }
          },
          onError: (error: unknown) => {
            removeSeat(seatSelection.seatKey);
            if (error instanceof ApiClientError && error.statusCode === 409) {
              toast.info('이미 다른 사용자가 선택한 좌석입니다');
              return;
            }

            toast.error('일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
          },
        },
      );
    },
    [
      addSeat,
      availableSeatMaps,
      bookingDisabledMessage,
      bookingAvailable,
      currentSeatMap,
      lockSeat,
      maxTicketsPerUser,
      removeSeat,
      seatStatesMap,
      seatStatesByFloorKey,
      selectedSeats,
      selectedShowtimeId,
      setTimerExpiry,
      ticketLimitCopy,
      tierInfoByFloorKey,
      tierInfoMap,
      unlockSeat,
    ],
  );

  const handleRemoveSeat = useCallback(
    (seatKey: string) => {
      if (!selectedShowtimeId) {
        return;
      }

      const seat = selectedSeats.find((selectedSeat) => selectedSeat.seatKey === seatKey);
      if (!seat) {
        return;
      }

      removeSeat(seat.seatKey);
      unlockSeat.mutate({ showtimeId: selectedShowtimeId, seatId: seat.seatKey });
    },
    [removeSeat, selectedSeats, selectedShowtimeId, unlockSeat],
  );

  const handleClearSeats = useCallback(() => {
    if (!selectedShowtimeId || selectedSeats.length === 0) {
      return;
    }

    unlockAll.mutate({ showtimeId: selectedShowtimeId });
    useBookingStore.getState().clearSeats();
  }, [selectedSeats.length, selectedShowtimeId, unlockAll]);

  const handleProceed = useCallback(() => {
    if (!selectedShowtimeId || !performance) {
      return;
    }
    if (!bookingAvailable) {
      toast.info(bookingDisabledMessage);
      return;
    }

    const selectedPerformanceShowtime = allShowtimes.find((showtime) => showtime.id === selectedShowtimeId);
    useBookingStore.getState().setBookingData({
      selectedSeats,
      showtimeId: selectedShowtimeId,
      performanceId,
      performanceTitle: performance.title,
      showDateTime: selectedPerformanceShowtime?.dateTime ?? null,
      venue: performance.venue?.name ?? null,
      posterUrl: performance.posterUrl ?? null,
      expiresAt: timerExpiresAt,
    });

    router.push(
      getLocalizedPathname(`/booking/${performanceId}/confirm`, activeLocale),
    );
  }, [
    activeLocale,
    allShowtimes,
    bookingDisabledMessage,
    bookingAvailable,
    performance,
    performanceId,
    router,
    selectedSeats,
    selectedShowtimeId,
    timerExpiresAt,
  ]);

  const handleBack = useCallback(() => {
    router.push(
      getLocalizedPathname(`/performance/${performanceId}`, activeLocale),
    );
  }, [activeLocale, performanceId, router]);

  const handleTimerExpire = useCallback(() => {
    useBookingStore.getState().expireTimer();
  }, []);

  const handleTimerReset = useCallback(() => {
    const { selectedShowtimeId: showtimeId } = useBookingStore.getState();
    if (showtimeId) {
      unlockAll.mutate({ showtimeId });
    }
    useBookingStore.getState().resetBooking();
  }, [unlockAll]);

  const handleDateSelect = useCallback(
    (date: Date) => {
      setDate(date);
      setShowtime(null);
    },
    [setDate, setShowtime],
  );

  if (bookingDisabledReason) {
    const disabledTitle = performance?.title ?? '예매 안내';
    const backLabel = performance?.title ?? '공연 상세로 돌아가기';

    return (
      <div className="flex flex-1 flex-col">
        <BookingHeader
          performanceTitle={disabledTitle}
          expiresAt={null}
          onBack={handleBack}
          onExpire={handleTimerExpire}
        />

        <main className="mx-auto flex w-full max-w-[760px] flex-1 items-center px-4 py-12">
          <section
            role="status"
            className="w-full rounded-lg border border-amber-200 bg-amber-50 px-5 py-6 text-center"
          >
            <p className="text-base font-semibold text-amber-900">
              {bookingDisabledReason}
            </p>
            <button
              type="button"
              onClick={handleBack}
              className="mt-4 inline-flex min-h-10 items-center rounded-md bg-white px-4 text-sm font-semibold text-amber-900 shadow-sm ring-1 ring-amber-200 hover:bg-amber-100"
            >
              {backLabel}
            </button>
          </section>
        </main>
      </div>
    );
  }

  if (performanceLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="sticky top-0 z-50 flex h-12 items-center justify-between border-b bg-white px-4 shadow-sm lg:h-14 lg:px-6">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="size-9 rounded-md" />
        </div>
        <div className="mx-auto w-full max-w-[1280px] px-4 py-4 pb-24 lg:px-6 lg:py-8 lg:pb-8">
          <div className="flex flex-col lg:flex-row lg:gap-8">
            <div className="min-w-0 flex-1 space-y-6">
              <Skeleton className="h-[200px] w-full rounded-lg" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20 rounded-lg" />
                <Skeleton className="h-9 w-20 rounded-lg" />
                <Skeleton className="h-9 w-20 rounded-lg" />
              </div>
              <Skeleton className="aspect-video w-full rounded-lg" />
            </div>
            <div className="hidden w-[360px] shrink-0 lg:block">
              <Skeleton className="h-[400px] w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!performance) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-base text-gray-600">
          {copy.performance.loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <BookingHeader
        performanceTitle={performance.title}
        expiresAt={timerExpiresAt}
        onBack={handleBack}
        onExpire={handleTimerExpire}
      />

      <main className="mx-auto w-full max-w-[1280px] px-4 py-4 pb-48 lg:px-6 lg:py-8 lg:pb-40">
        <div className="min-w-0 space-y-6">
            <div className="rounded-lg border border-border p-3 lg:border-0 lg:p-0">
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center justify-between lg:hidden"
                onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                aria-expanded={isDatePickerOpen}
              >
                <span className="text-sm font-semibold text-gray-900">
                  {selectedDate
                    ? `${selectedDate.getMonth() + 1}/${selectedDate.getDate()}${selectedShowtimeId ? ' - 회차 선택완료' : ''}`
                    : '날짜 / 회차 선택'}
                </span>
                <ChevronDown
                  className={`h-5 w-5 text-gray-500 transition-transform ${isDatePickerOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <div className={`${isDatePickerOpen ? 'block' : 'hidden'} lg:block`}>
                <div className="mt-3 lg:mt-0">
                  <h2 className="mb-2 text-sm font-normal text-gray-700">
                    날짜 선택
                  </h2>
                  <DatePicker
                    availableDates={availableDates}
                    selected={selectedDate}
                    onSelect={handleDateSelect}
                  />
                </div>

                {selectedDate ? (
                  <div className="mt-4 lg:mt-6">
                    <h2 className="mb-2 text-sm font-normal text-gray-700">
                      회차 선택
                    </h2>
                    <ShowtimeChips
                      showtimes={filteredShowtimes}
                      selected={selectedShowtimeId}
                      onSelect={(id) => {
                        setShowtime(id);
                        if (id && window.innerWidth < 1024) {
                          setIsDatePickerOpen(false);
                        }
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {selectedShowtimeId && currentSeatMap && seatConfig ? (
              <>
                <FloorSelector
                  floors={floorOptions}
                  selectedFloorKey={currentSeatMap.floorKey}
                  onChange={setSelectedFloorKey}
                />

                <section className="rounded-2xl border border-border bg-[#F5F5F7] px-4 py-4">
                  <p className="text-sm font-semibold text-gray-900">
                    {ticketLimitCopy}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {seatChangePolicyCopy}
                  </p>
                  {currentFloorOption?.isSoldOut ? (
                    <p className="mt-2 text-sm font-semibold text-amber-800">
                      현재 층은 선택 가능한 좌석이 없습니다. 다른 층을 확인해주세요.
                    </p>
                  ) : null}
                </section>

                <SeatLegend tiers={legendTiers} showExcluded />

                <section className="rounded-xl border border-border bg-white px-4 py-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-gray-900">
                      선택 좌석
                    </h2>
                    <span className="text-sm font-semibold text-primary">
                      {selectedSeats.length}석
                    </span>
                  </div>
                  <SelectionTags
                    seats={sortedSelections}
                    onRemove={handleRemoveSeat}
                  />
                </section>

                <SeatMapViewer
                  svgUrl={currentSeatMap.svgUrl}
                  seatConfig={seatConfig}
                  seatStates={seatStatesMap}
                  selectedSeatIds={selectedSeatIds}
                  onSeatClick={handleSeatClick}
                  maxSelect={maxTicketsPerUser}
                />
              </>
            ) : null}
        </div>
      </main>

      {selectedShowtimeId ? (
        <BookingSelectionBar
          tierSummaries={tierSummaries}
          selectedSeatCount={selectedSeats.length}
          totalPrice={totalPrice}
          canClear={selectedSeats.length > 0}
          onClear={handleClearSeats}
          onProceed={handleProceed}
          isLoading={lockSeat.isPending || unlockAll.isPending}
          disabledReason={bookingDisabledReason}
        />
      ) : null}

      <TimerExpiredModal open={isTimerExpired} onReset={handleTimerReset} />
    </div>
  );
}
