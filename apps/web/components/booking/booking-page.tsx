'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  FloorAwareSeatSelection,
  SeatMap,
  SeatMapConfig,
  SeatState,
  Showtime,
} from '@grabit/shared';
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
  formatKstDateLabel,
  formatKstTimeLabel,
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

const DEFAULT_FLOOR_KEY = '1F';

type RuntimeSeatState = SeatState | 'disabled';

type RuntimeSeatIdentity = {
  seatId: string;
  floorKey: string;
  seatKey: string;
};

type GroupedFloorSelection = {
  floorKey: string;
  floorLabel: string;
  seats: FloorAwareSeatSelection[];
};

function parseRuntimeSeatIdentity(rawSeatIdOrKey: string): RuntimeSeatIdentity {
  const separatorIndex = rawSeatIdOrKey.indexOf(':');
  const floorKey = separatorIndex > 0
    ? rawSeatIdOrKey.slice(0, separatorIndex)
    : DEFAULT_FLOOR_KEY;
  const seatId = separatorIndex > 0
    ? rawSeatIdOrKey.slice(separatorIndex + 1)
    : rawSeatIdOrKey;

  return {
    seatId,
    floorKey,
    seatKey: separatorIndex > 0 ? rawSeatIdOrKey : `${floorKey}:${seatId}`,
  };
}

function isUnavailableSeatState(state: RuntimeSeatState | undefined) {
  return state === 'locked' || state === 'sold' || state === 'held' || state === 'disabled';
}

function SelectionGroups({
  groups,
  onRemove,
}: {
  groups: GroupedFloorSelection[];
  onRemove: (seatKey: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="mt-3 text-sm text-gray-500">
        선택한 좌석이 없습니다. 좌석을 선택하면 결제 단계로 이동할 수 있습니다.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {groups.map((group) => (
        <section
          key={group.floorKey}
          className="rounded-xl border border-border bg-[#F5F5F7] p-4"
        >
          <h3 className="text-sm font-semibold text-gray-900">
            {group.floorLabel}
          </h3>
          <div className="mt-3 space-y-2">
            {group.seats.map((seat) => (
              <div
                key={seat.seatKey}
                className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-full"
                      style={{ backgroundColor: seat.tierColor }}
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {seat.tierName}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-900">
                    {seat.row}열 {seat.number}번
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-base font-semibold text-gray-900">
                    {seat.price.toLocaleString()}원
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(seat.seatKey)}
                    aria-label="좌석 선택 해제"
                    className="flex size-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DesktopSelectionSummary({
  performanceTitle,
  selectedDate,
  selectedShowtime,
  groups,
  selectedSeatCount,
  totalPrice,
  onRemove,
  onProceed,
  isLoading,
  disabledReason,
}: {
  performanceTitle: string;
  selectedDate: Date | null;
  selectedShowtime: Showtime | null;
  groups: GroupedFloorSelection[];
  selectedSeatCount: number;
  totalPrice: number;
  onRemove: (seatKey: string) => void;
  onProceed: () => void;
  isLoading: boolean;
  disabledReason: string | null;
}) {
  return (
    <aside className="hidden w-[360px] shrink-0 lg:block">
      <div className="sticky top-16 space-y-5 rounded-2xl border border-border bg-white p-6 shadow-sm">
        <div>
          <p className="truncate text-base font-semibold text-gray-900">
            {performanceTitle}
          </p>
          {selectedDate && selectedShowtime ? (
            <p className="mt-1 text-sm text-gray-500">
              {formatKstDateLabel(selectedShowtime.dateTime)} {formatKstTimeLabel(selectedShowtime.dateTime)}
            </p>
          ) : null}
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900">선택 좌석</h2>
          <SelectionGroups groups={groups} onRemove={onRemove} />
        </div>

        <div className="rounded-xl border border-border bg-[#F5F5F7] px-4 py-4">
          <p className="text-sm text-gray-500">총 합계</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-base text-gray-700">{selectedSeatCount}석</span>
            <span className="text-xl font-semibold text-gray-900">
              {totalPrice.toLocaleString()}원
            </span>
          </div>
        </div>

        {disabledReason ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            {disabledReason}
          </p>
        ) : null}

        <Button
          className="h-12 w-full text-base"
          disabled={!!disabledReason || selectedSeatCount === 0 || isLoading}
          onClick={onProceed}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              처리 중...
            </>
          ) : disabledReason ?? (selectedSeatCount === 0 ? '좌석을 선택해주세요' : '다음')}
        </Button>
      </div>
    </aside>
  );
}

function MobileSelectionSummary({
  groups,
  selectedSeatCount,
  totalPrice,
  onRemove,
  onProceed,
  isLoading,
  disabledReason,
}: {
  groups: GroupedFloorSelection[];
  selectedSeatCount: number;
  totalPrice: number;
  onRemove: (seatKey: string) => void;
  onProceed: () => void;
  isLoading: boolean;
  disabledReason: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (selectedSeatCount === 0) {
      setIsOpen(false);
    }
  }, [selectedSeatCount]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 shadow-[0_-12px_32px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
      {isOpen ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">선택 좌석</h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex size-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              aria-label="선택 좌석 접기"
            >
              <ChevronDown className="size-5" />
            </button>
          </div>
          <div className="max-h-[45vh] overflow-y-auto pr-1">
            <SelectionGroups groups={groups} onRemove={onRemove} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (selectedSeatCount > 0) {
              setIsOpen(true);
            }
          }}
          className="mb-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-border bg-[#F5F5F7] px-4 py-3 text-left"
          aria-expanded={isOpen}
        >
          <span className="text-sm font-medium text-gray-900">
            {selectedSeatCount === 0
              ? '선택한 좌석이 없습니다'
              : `${selectedSeatCount}석 선택 | ${totalPrice.toLocaleString()}원`}
          </span>
          {selectedSeatCount > 0 ? (
            <span className="text-sm font-semibold text-primary">상세 보기</span>
          ) : (
            <span className="text-sm text-gray-500">좌석을 선택해주세요</span>
          )}
        </button>
      )}

      <Button
        className="h-12 w-full text-base"
        disabled={!!disabledReason || selectedSeatCount === 0 || isLoading}
        onClick={onProceed}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            처리 중...
          </>
        ) : disabledReason ?? (selectedSeatCount === 0 ? '좌석을 선택해주세요' : '다음')}
      </Button>
    </div>
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
  const { bookingAvailable, bookingDisabledMessage } = useBookingAvailability();
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

  const selectedShowtime = useMemo(
    () => allShowtimes.find((showtime) => showtime.id === selectedShowtimeId) ?? null,
    [allShowtimes, selectedShowtimeId],
  );

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

  const groupedSelections = useMemo(() => {
    const groups = new Map<string, GroupedFloorSelection>();

    for (const seat of selectedSeats) {
      const existingGroup = groups.get(seat.floorKey);
      if (existingGroup) {
        existingGroup.seats.push(seat);
        continue;
      }

      groups.set(seat.floorKey, {
        floorKey: seat.floorKey,
        floorLabel: seat.floorLabel,
        seats: [seat],
      });
    }

    return Array.from(groups.values()).sort((left, right) => {
      const leftOrder = floorOrderMap.get(left.floorKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = floorOrderMap.get(right.floorKey) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  }, [floorOrderMap, selectedSeats]);

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

      <main className="mx-auto w-full max-w-[1280px] px-4 py-4 pb-32 lg:px-6 lg:py-8 lg:pb-8">
        <div className="flex flex-col lg:flex-row lg:gap-8">
          <div className="min-w-0 flex-1 space-y-6">
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

                <SeatLegend tiers={legendTiers} />

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

          <DesktopSelectionSummary
            performanceTitle={performance.title}
            selectedDate={selectedDate}
            selectedShowtime={selectedShowtime}
            groups={groupedSelections}
            selectedSeatCount={selectedSeats.length}
            totalPrice={totalPrice}
            onRemove={handleRemoveSeat}
            onProceed={handleProceed}
            isLoading={lockSeat.isPending}
            disabledReason={bookingDisabledReason}
          />
        </div>
      </main>

      {selectedShowtimeId ? (
        <MobileSelectionSummary
          groups={groupedSelections}
          selectedSeatCount={selectedSeats.length}
          totalPrice={totalPrice}
          onRemove={handleRemoveSeat}
          onProceed={handleProceed}
          isLoading={lockSeat.isPending}
          disabledReason={bookingDisabledReason}
        />
      ) : null}

      <TimerExpiredModal open={isTimerExpired} onReset={handleTimerReset} />
    </div>
  );
}
