'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { SeatSelection, SeatState, SeatMapConfig } from '@grabit/shared';
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
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import { ApiClientError } from '@/lib/api-client';
import { BookingHeader } from './booking-header';
import { DatePicker } from './date-picker';
import { ShowtimeChips } from './showtime-chips';
import { SeatLegend } from './seat-legend';
import { SeatMapViewer } from './seat-map-viewer';
import { SeatSelectionPanel } from './seat-selection-panel';
import { SeatSelectionSheet } from './seat-selection-sheet';
import { TimerExpiredModal } from './timer-expired-modal';
import { Skeleton } from '@/components/ui/skeleton';

const MAX_SEATS = 4;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function BookingPage({ performanceId }: { performanceId: string }) {
  const router = useRouter();
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

  // WebSocket real-time connection
  useBookingSocket(selectedShowtimeId);

  const { data: seatStatusData } = useSeatStatus(selectedShowtimeId);
  const { data: myLocksData } = useMyLocks(selectedShowtimeId);
  const lockSeat = useLockSeat();
  const unlockSeat = useUnlockSeat();
  const unlockAll = useUnlockAllSeats();
  const { bookingEnabled, bookingDisabledMessage } = useRuntimeFlags();
  const bookingDisabledReason = bookingEnabled ? null : bookingDisabledMessage;

  // All showtimes sourced from performance detail
  const allShowtimes = useMemo(
    () => performance?.showtimes ?? [],
    [performance?.showtimes],
  );

  // Available dates: unique dates from showtimes
  const availableDates = useMemo(() => {
    const dateMap = new Map<string, Date>();
    for (const st of allShowtimes) {
      const d = new Date(st.dateTime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!dateMap.has(key)) {
        dateMap.set(key, new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      }
    }
    return Array.from(dateMap.values());
  }, [allShowtimes]);

  // Showtimes for selected date
  const filteredShowtimes = useMemo(() => {
    if (!selectedDate) return [];
    return allShowtimes.filter((st) =>
      isSameDay(new Date(st.dateTime), selectedDate),
    );
  }, [allShowtimes, selectedDate]);

  // Selected showtime object
  const selectedShowtime = useMemo(
    () => allShowtimes.find((st) => st.id === selectedShowtimeId) ?? null,
    [allShowtimes, selectedShowtimeId],
  );

  // Seat states map
  const seatStatesMap = useMemo(() => {
    const map = new Map<string, SeatState>();
    if (seatStatusData?.seats) {
      for (const [seatId, state] of Object.entries(seatStatusData.seats)) {
        map.set(seatId, state);
      }
    }
    return map;
  }, [seatStatusData]);

  // Selected seat IDs as a set
  const selectedSeatIds = useMemo(
    () => new Set(selectedSeats.map((s) => s.seatId)),
    [selectedSeats],
  );

  // Seat config
  const seatConfig: SeatMapConfig | null =
    performance?.seatMap?.seatConfig ?? null;

  // Tiers for legend: merge seatConfig with priceTiers
  const legendTiers = useMemo(() => {
    if (!seatConfig || !performance?.priceTiers) return [];
    return seatConfig.tiers
      .map((tier) => {
        const priceTier = performance.priceTiers.find(
          (pt) => pt.tierName === tier.tierName,
        );
        return {
          name: tier.tierName,
          color: tier.color,
          price: priceTier?.price ?? 0,
        };
      })
      .sort((a, b) => b.price - a.price);
  }, [seatConfig, performance?.priceTiers]);

  // Build tier info map for seat click handling
  const tierInfoMap = useMemo(() => {
    const map = new Map<
      string,
      { tierName: string; color: string; price: number }
    >();
    if (!seatConfig || !performance?.priceTiers) return map;
    for (const tier of seatConfig.tiers) {
      const priceTier = performance.priceTiers.find(
        (pt) => pt.tierName === tier.tierName,
      );
      for (const seatId of tier.seatIds) {
        map.set(seatId, {
          tierName: tier.tierName,
          color: tier.color,
          price: priceTier?.price ?? 0,
        });
      }
    }
    return map;
  }, [seatConfig, performance?.priceTiers]);

  // Restore session: if user has existing locks from before refresh
  useEffect(() => {
    if (!myLocksData || myLocksData.seatIds.length === 0) return;
    if (selectedSeats.length > 0) return; // already have local state

    for (const seatId of myLocksData.seatIds) {
      const info = tierInfoMap.get(seatId);
      if (!info) continue;
      const parts = seatId.split('-');
      addSeat({
        seatId,
        tierName: info.tierName,
        tierColor: info.color,
        row: parts[0] ?? '',
        number: parts[1] ?? '',
        price: info.price,
      });
    }

    if (myLocksData.expiresAt) {
      setTimerExpiry(myLocksData.expiresAt);
    }
  }, [myLocksData, tierInfoMap, selectedSeats.length, addSeat, setTimerExpiry]);

  // Seat click handler (optimistic UI)
  const handleSeatClick = useCallback(
    (seatId: string) => {
      if (!selectedShowtimeId) return;
      if (!bookingEnabled) {
        toast.info(bookingDisabledMessage);
        return;
      }

      // Locked seat: show toast and return
      const seatState = seatStatesMap.get(seatId);
      if (seatState === 'locked' && !selectedSeatIds.has(seatId)) {
        toast.info('이미 다른 사용자가 선택한 좌석입니다');
        return;
      }

      // If already selected -> deselect
      if (selectedSeatIds.has(seatId)) {
        removeSeat(seatId);
        unlockSeat.mutate({ showtimeId: selectedShowtimeId, seatId });
        return;
      }

      // Max seats check
      if (selectedSeats.length >= MAX_SEATS) {
        toast.error(
          '최대 4석까지 선택할 수 있습니다. 다른 좌석을 먼저 해제해주세요.',
        );
        return;
      }

      // Get tier info for this seat
      const info = tierInfoMap.get(seatId);
      if (!info) return;

      // Parse row/number from seatId (e.g. "A-1")
      const parts = seatId.split('-');
      const row = parts[0] ?? seatId;
      const number = parts[1] ?? '';

      const seatSelection: SeatSelection = {
        seatId,
        tierName: info.tierName,
        tierColor: info.color,
        row,
        number,
        price: info.price,
      };

      // Optimistic: add immediately
      addSeat(seatSelection);

      // Call lock API
      lockSeat.mutate(
        { showtimeId: selectedShowtimeId, seatId },
        {
          onSuccess: (response) => {
            if (response.expiresAt) {
              setTimerExpiry(response.expiresAt);
            }
          },
          onError: (error: unknown) => {
            // Race condition: revert optimistic update
            removeSeat(seatId);
            if (
              error instanceof ApiClientError &&
              error.statusCode === 409
            ) {
              toast.info('이미 다른 사용자가 선택한 좌석입니다');
            } else {
              toast.error(
                '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
              );
            }
          },
        },
      );
    },
    [
      selectedShowtimeId,
      seatStatesMap,
      selectedSeatIds,
      selectedSeats.length,
      tierInfoMap,
      addSeat,
      removeSeat,
      lockSeat,
      unlockSeat,
      setTimerExpiry,
      bookingEnabled,
      bookingDisabledMessage,
    ],
  );

  // Remove seat from panel
  const handleRemoveSeat = useCallback(
    (seatId: string) => {
      if (!selectedShowtimeId) return;
      removeSeat(seatId);
      unlockSeat.mutate({ showtimeId: selectedShowtimeId, seatId });
    },
    [selectedShowtimeId, removeSeat, unlockSeat],
  );

  // "Next" button handler — navigate to confirm page
  const handleProceed = useCallback(() => {
    if (!selectedShowtimeId || !performance) return;
    if (!bookingEnabled) {
      toast.info(bookingDisabledMessage);
      return;
    }

    const selectedSt = allShowtimes.find((st) => st.id === selectedShowtimeId);

    useBookingStore.getState().setBookingData({
      selectedSeats,
      showtimeId: selectedShowtimeId,
      performanceId,
      performanceTitle: performance.title,
      showDateTime: selectedSt?.dateTime ?? null,
      venue: performance.venue?.name ?? null,
      posterUrl: performance.posterUrl ?? null,
      expiresAt: timerExpiresAt,
    });

    router.push(`/booking/${performanceId}/confirm`);
  }, [
    selectedShowtimeId,
    selectedSeats,
    performance,
    allShowtimes,
    performanceId,
    timerExpiresAt,
    router,
    bookingEnabled,
    bookingDisabledMessage,
  ]);

  const handleBack = useCallback(() => {
    router.push(`/performance/${performanceId}`);
  }, [router, performanceId]);

  // Timer expiry handler
  const handleTimerExpire = useCallback(() => {
    useBookingStore.getState().expireTimer();
  }, []);

  // Timer expiry modal reset handler:
  // Read showtimeId BEFORE resetBooking clears it, then fire-and-forget unlock-all.
  // If API call fails, locks expire via TTL anyway -- no error toast needed.
  const handleTimerReset = useCallback(() => {
    const { selectedShowtimeId: stId } = useBookingStore.getState();
    if (stId) {
      unlockAll.mutate({ showtimeId: stId });
    }
    useBookingStore.getState().resetBooking();
  }, [unlockAll]);

  // Collapsible state for mobile date/showtime picker
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(true);

  // Date selection handler
  const handleDateSelect = useCallback(
    (date: Date) => {
      setDate(date);
      setShowtime(null);
    },
    [setDate, setShowtime],
  );

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
          공연 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
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

      <main className="mx-auto w-full max-w-[1280px] px-4 py-4 pb-24 lg:px-6 lg:py-8 lg:pb-8">
        <div className="flex flex-col lg:flex-row lg:gap-8">
          {/* Left column */}
          <div className="min-w-0 flex-1 space-y-6">
            {/* Date/Showtime picker - collapsible on mobile */}
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
                {/* Date picker */}
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

                {/* Showtime chips */}
                {selectedDate && (
                  <div className="mt-4 lg:mt-6">
                    <h2 className="mb-2 text-sm font-normal text-gray-700">
                      회차 선택
                    </h2>
                    <ShowtimeChips
                      showtimes={filteredShowtimes}
                      selected={selectedShowtimeId}
                      onSelect={(id) => {
                        setShowtime(id);
                        // Auto-collapse on mobile after showtime selection
                        if (id && window.innerWidth < 1024) {
                          setIsDatePickerOpen(false);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Seat legend + map */}
            {selectedShowtimeId && seatConfig && performance.seatMap && (
              <>
                {bookingDisabledReason && (
                  <div
                    role="status"
                    className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
                  >
                    {bookingDisabledReason}
                  </div>
                )}
                <SeatLegend tiers={legendTiers} />
                <SeatMapViewer
                  svgUrl={performance.seatMap.svgUrl}
                  seatConfig={seatConfig}
                  seatStates={seatStatesMap}
                  selectedSeatIds={selectedSeatIds}
                  onSeatClick={handleSeatClick}
                  maxSelect={MAX_SEATS}
                />
              </>
            )}
          </div>

          {/* Right column: desktop panel */}
          <SeatSelectionPanel
            performanceTitle={performance.title}
            selectedDate={selectedDate}
            selectedShowtime={selectedShowtime}
            selectedSeats={selectedSeats}
            onRemove={handleRemoveSeat}
            onProceed={handleProceed}
            isLoading={lockSeat.isPending}
            disabledReason={bookingDisabledReason}
          />
        </div>
      </main>

      {/* Mobile bottom sheet */}
      <SeatSelectionSheet
        performanceTitle={performance.title}
        selectedDate={selectedDate}
        selectedShowtime={selectedShowtime}
        selectedSeats={selectedSeats}
        onRemove={handleRemoveSeat}
        onProceed={handleProceed}
        isLoading={lockSeat.isPending}
        disabledReason={bookingDisabledReason}
      />

      {/* Timer expiry modal */}
      <TimerExpiredModal open={isTimerExpired} onReset={handleTimerReset} />
    </div>
  );
}
