'use client';

import { getSeatSelectionCopy, formatSeatSelectionPrice } from '@/lib/booking/seat-selection-copy';
import { formatCopy } from '@/lib/i18n/client-copy';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  FloorAwareSeatSelection,
  SeatMapConfig,
  SeatState,
  Showtime,
} from '@grabit/shared';
import { normalizeSeatIdentity, TICKET_SERVICE_FEE_KRW } from '@grabit/shared';
import { usePerformanceDetail } from '@/hooks/use-performances';
import {
  useSeatStatus,
  useMyLocks,
  type MyLocksSnapshot,
} from '@/hooks/use-booking';
import {
  useSeatLockController,
  type SeatLockRejection,
} from '@/hooks/use-seat-lock-controller';
import { HOLD_EXPIRY_MARGIN_MS, useBookingStore } from '@/stores/use-booking-store';
import { useBookingSocket } from '@/hooks/use-socket';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useShowtimeSalesClock } from '@/hooks/use-showtime-sales-clock';
import { ApiClientError } from '@/lib/api-client';
import { getDefaultErrorMessage, getStatusMessages } from '@/lib/error-messages';
import { BookingDisabledError } from '@/lib/runtime-flags';
import { nextSeatSyncSequence } from '@/lib/booking/seat-sync-sequence';
import {
  isShowtimeSalesClosed,
  isShowtimeSalesClosedError,
} from '@/lib/booking/showtime-sales';
import {
  getKstCalendarDate,
  getKstCalendarKey,
  isSameKstCalendarDate,
} from '@/lib/booking-datetime';
import {
  earliestDeadline,
  getQueueAccessClosedCopy,
  isQueueAccessRejection,
} from '@/lib/booking/queue-access';
import { getServerNowMs } from '@/lib/server-clock';
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
import { BookingProgress } from './booking-progress';
import { SeatSectionSelector } from './seat-section-selector';
import { formatEventTimeWithKstAnchor } from '@/lib/i18n/format';

type RuntimeSeatState = SeatState | 'disabled';
type FloorSeatStates = ReadonlyMap<string, RuntimeSeatState>;
type SeatStatusSeats = Record<string, string> | undefined;

/**
 * Shared empty states: a fresh `new Map()` per render would hand the seat map
 * a new reference on every seat-update and re-run its per-seat comparison.
 */
const EMPTY_SEAT_STATES: FloorSeatStates = new Map();
const EMPTY_FLOOR_SEAT_STATES: ReadonlyMap<string, FloorSeatStates> = new Map();

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

/** Seat states per floor, each keyed by both seatKey and floor-local seatId. */
function buildSeatStatesByFloorKey(seats: SeatStatusSeats): Map<string, Map<string, RuntimeSeatState>> {
  const map = new Map<string, Map<string, RuntimeSeatState>>();
  if (!seats) {
    return map;
  }

  for (const [runtimeSeatId, state] of Object.entries(seats)) {
    const seatIdentity = parseRuntimeSeatIdentity(runtimeSeatId);
    const floorMap = map.get(seatIdentity.floorKey) ?? new Map<string, RuntimeSeatState>();
    floorMap.set(seatIdentity.seatKey, state as RuntimeSeatState);
    floorMap.set(seatIdentity.seatId, state as RuntimeSeatState);
    map.set(seatIdentity.floorKey, floorMap);
  }

  return map;
}

function hasSameSeatStates(previous: FloorSeatStates, next: FloorSeatStates): boolean {
  if (previous === next) {
    return true;
  }
  if (previous.size !== next.size) {
    return false;
  }
  for (const [seatId, state] of next) {
    if (previous.get(seatId) !== state) {
      return false;
    }
  }
  return true;
}

/**
 * Keeps the previous Map of every floor whose states did not change (and the
 * previous outer Map when no floor changed), so a seat-update on another floor
 * leaves the shown floor's seat map, its props and memoized values untouched.
 */
function shareUnchangedFloors(
  previous: ReadonlyMap<string, FloorSeatStates>,
  next: ReadonlyMap<string, FloorSeatStates>,
): ReadonlyMap<string, FloorSeatStates> {
  let changed = previous.size !== next.size;
  const shared = new Map<string, FloorSeatStates>();
  for (const [floorKey, states] of next) {
    const previousStates = previous.get(floorKey);
    if (previousStates && hasSameSeatStates(previousStates, states)) {
      shared.set(floorKey, previousStates);
    } else {
      shared.set(floorKey, states);
      changed = true;
    }
  }
  return changed ? shared : previous;
}

/** Order-independent identity of a selection, to detect edits. */
function toSelectionKey(seats: readonly FloorAwareSeatSelection[]): string {
  return seats.map((seat) => seat.seatKey).sort().join('|');
}

function formatSeatLabel(seat: FloorAwareSeatSelection) {
  return formatCopy(getSeatSelectionCopy().seatLabel, { floor: seat.floorLabel, row: seat.row, number: seat.number });
}

function SelectionTags({
  seats,
  onRemove,
}: {
  seats: FloorAwareSeatSelection[];
  onRemove: (seatKey: string) => void;
}) {
  const seatCopy = getSeatSelectionCopy();
  if (seats.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {seatCopy.emptySelection}
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {seats.map((seat) => (
        <button
          key={seat.seatKey}
          type="button"
          onClick={() => onRemove(seat.seatKey)}
          aria-label={formatCopy(seatCopy.removeSeat, { seat: formatSeatLabel(seat) })}
          className="flex min-h-14 items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left text-xs font-medium text-gray-800 hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ backgroundColor: seat.tierColor ?? '#6C3CE0' }} />{seat.tierName}</span>
          <span className="flex-1">{formatSeatLabel(seat)}<span className="mt-1 block text-gray-500">{formatSeatSelectionPrice(seat.price)}</span></span>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function BookingSelectionBar({
  tierSummaries,
  seats,
  onRemove,
  selectedSeatCount,
  totalPrice,
  canClear,
  onClear,
  onProceed,
  isLoading,
  disabledReason,
}: {
  tierSummaries: TierSummary[];
  seats: FloorAwareSeatSelection[];
  onRemove: (key: string) => void;
  selectedSeatCount: number;
  totalPrice: number;
  canClear: boolean;
  onClear: () => void;
  onProceed: () => void;
  isLoading: boolean;
  disabledReason: string | null;
}) {
  const seatCopy = getSeatSelectionCopy();
  const [expanded, setExpanded] = useState(false);
  return (
    <aside
      role="complementary"
      aria-label={seatCopy.selectionSummary}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3 shadow-[0_-12px_32px_rgba(0,0,0,0.06)] backdrop-blur lg:sticky lg:top-20 lg:inset-x-auto lg:self-start lg:rounded-2xl lg:border lg:p-5 lg:shadow-sm"
    >
      <div className="mx-auto grid w-full gap-4">
        <div>
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
            className="flex w-full items-center justify-between text-sm font-semibold lg:hidden">
            <span>{seatCopy.selectedSeats} <span className="ml-1 text-primary">{selectedSeatCount}</span></span>
            <ChevronDown className={`size-4 lg:hidden ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <h2 className="hidden text-sm font-semibold lg:block">{seatCopy.selectedSeats} <span className="ml-1 text-primary">{selectedSeatCount}</span></h2>
          <div className={`${expanded ? 'block' : 'hidden'} mt-3 max-h-[28dvh] overflow-y-auto lg:block lg:max-h-[38dvh]`}>
            <SelectionTags seats={seats} onRemove={onRemove} />
          </div>
        </div>
        <div className={disabledReason ? 'min-w-0' : 'hidden min-w-0 lg:block'}>
          <div className="hidden flex-wrap items-center gap-2 text-sm lg:flex">
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
                  <span>{formatCopy(seatCopy.seatCount, { count: summary.count })}</span>
                </span>
              ))
            ) : (
              <span className="inline-flex min-h-8 items-center rounded-lg bg-[#F5F5F7] px-3 text-gray-500">
                {seatCopy.selectedSeats} · {formatCopy(seatCopy.seatCount, { count: 0 })}
              </span>
            )}
            <span className="inline-flex min-h-8 items-center rounded-lg bg-[#F5F5F7] px-3 font-semibold text-gray-800">
              {formatCopy(seatCopy.totalSeatCount, { count: selectedSeatCount })}
            </span>
          </div>
          {disabledReason ? (
            <p className="mt-2 text-sm font-semibold text-amber-800">
              {disabledReason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="text-right text-2xl font-extrabold text-gray-950">
            <small className="mr-2 text-sm font-medium text-gray-500">
              {seatCopy.orderTotal}
            </small>
            {formatSeatSelectionPrice(totalPrice)}
          </p>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-4"
              disabled={!canClear || isLoading}
              onClick={onClear}
            >
              {seatCopy.clearAll}
            </Button>
            <Button
              className="h-11 min-w-28 px-5 text-base"
              disabled={!!disabledReason || selectedSeatCount === 0 || isLoading}
              onClick={onProceed}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {seatCopy.processing}
                </>
              ) : selectedSeatCount === 0 ? seatCopy.chooseSeat : seatCopy.next}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function BookingPage({
  performanceId,
  initialShowtimeId = null,
  queueAccessExpiresAt = null,
  onQueueAccessRejected,
}: {
  performanceId: string;
  initialShowtimeId?: string | null;
  /** Server queue access window end (epoch ms); seat locks need it too. */
  queueAccessExpiresAt?: number | null;
  /**
   * A seat lock was refused for the queue admission itself (window over, the
   * admission used up by a purchase in another tab, missing admission). The
   * route re-reads the queue status and leaves the seat screen.
   */
  onQueueAccessRejected?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);
  const seatCopy = copy.booking.seatSelection;
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

  const initialSelectionRef = useRef('');
  const [sectionFocus, setSectionFocus] = useState<{ floorKey: string; sectionKey: string } | null>(null);
  const [selectedFloorKey, setSelectedFloorKey] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(true);
  const [isVerifyingSelection, setIsVerifyingSelection] = useState(false);

  const allShowtimes = useMemo(
    () => performance?.showtimes ?? [],
    [performance?.showtimes],
  );
  const salesNow = useShowtimeSalesClock(allShowtimes);
  const bookableShowtimes = useMemo(
    () => allShowtimes.filter((showtime) => !isShowtimeSalesClosed(showtime.dateTime, salesNow)),
    [allShowtimes, salesNow],
  );
  // The booking store is global: a showtime left over from another
  // performance, or one that already started, is never used for requests.
  const activeShowtime = useMemo(
    () => bookableShowtimes.find((showtime) => showtime.id === selectedShowtimeId) ?? null,
    [bookableShowtimes, selectedShowtimeId],
  );
  const activeShowtimeId = activeShowtime?.id ?? null;

  useBookingSocket(activeShowtimeId);

  const { data: seatStatusData } = useSeatStatus(activeShowtimeId);
  const myLocksQuery = useMyLocks(activeShowtimeId);
  const myLocksData = myLocksQuery.data;
  const refetchMyLocks = myLocksQuery.refetch;
  const lockRejectedHandlerRef = useRef<(rejection: SeatLockRejection) => void>(() => undefined);
  const seatLocks = useSeatLockController({
    onLockRejected: (rejection) => lockRejectedHandlerRef.current(rejection),
  });
  const { bookingAvailable, bookingDisabledMessage } = useBookingAvailability({
    performanceStatus: performance?.status,
    bookingStartsAt: performance?.bookingPolicy?.bookingStartsAt,
  });
  const bookingDisabledReason = bookingAvailable ? null : bookingDisabledMessage;
  // Count down to whichever ends first: the seat lock or the queue access
  // window (the server needs both for lock and prepare).
  const bookingDeadlineAt = earliestDeadline(timerExpiresAt, queueAccessExpiresAt);

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

  // Started showtimes are closed for sale, so their dates/chips are not offered.
  const availableDates = useMemo(() => {
    const dateMap = new Map<string, Date>();
    for (const showtime of bookableShowtimes) {
      const key = getKstCalendarKey(showtime.dateTime);
      if (!dateMap.has(key)) {
        dateMap.set(key, getKstCalendarDate(showtime.dateTime));
      }
    }
    return Array.from(dateMap.values());
  }, [bookableShowtimes]);

  const filteredShowtimes = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    return bookableShowtimes.filter((showtime) =>
      isSameKstCalendarDate(showtime.dateTime, selectedDate),
    );
  }, [bookableShowtimes, selectedDate]);

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
          tierMap.set(normalizeSeatIdentity({ seatId, floorKey: seatMap.floorKey }).seatId, {
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

  // Rebuilt only when the cached seats change (one batch of seat-update events
  // per frame, a poll, a resync). Floors whose states did not change keep the
  // Map they had, compared by content against the last published states.
  const seatStatusSeats: SeatStatusSeats = seatStatusData?.seats;
  const builtSeatStatesByFloorKey = useMemo(
    () => buildSeatStatesByFloorKey(seatStatusSeats),
    [seatStatusSeats],
  );
  const [publishedSeatStates, setPublishedSeatStates] = useState(EMPTY_FLOOR_SEAT_STATES);
  const seatStatesByFloorKey = useMemo(
    () => shareUnchangedFloors(publishedSeatStates, builtSeatStatesByFloorKey),
    [builtSeatStatesByFloorKey, publishedSeatStates],
  );
  if (seatStatesByFloorKey !== publishedSeatStates) {
    // Settles in one extra render pass: the next comparison finds every floor
    // unchanged and returns the published states themselves.
    setPublishedSeatStates(seatStatesByFloorKey);
  }

  // Read by the click handler so it does not change with every seat-update.
  const seatStatesByFloorKeyRef = useRef(seatStatesByFloorKey);
  useLayoutEffect(() => {
    seatStatesByFloorKeyRef.current = seatStatesByFloorKey;
  }, [seatStatesByFloorKey]);

  const seatStatesMap: FloorSeatStates = currentSeatMap
    ? seatStatesByFloorKey.get(currentSeatMap.floorKey) ?? EMPTY_SEAT_STATES
    : EMPTY_SEAT_STATES;

  const selectedSeatIds = useMemo(
    () => new Set(
      selectedSeats
        .filter((seat) => seat.floorKey === currentSeatMap?.floorKey)
        .map((seat) => seat.seatId),
    ),
    [currentSeatMap?.floorKey, selectedSeats],
  );

  const myLockedSeatIds = useMemo(() => {
    const seatIds = new Set<string>();
    if (!currentSeatMap || !myLocksData?.seatIds) {
      return seatIds;
    }

    for (const runtimeSeatId of myLocksData.seatIds) {
      const seatIdentity = parseRuntimeSeatIdentity(runtimeSeatId);
      if (seatIdentity.floorKey === currentSeatMap.floorKey) {
        seatIds.add(seatIdentity.seatId);
      }
    }

    return seatIds;
  }, [currentSeatMap, myLocksData]);

  /**
   * What the seat map shows for seats with this page's own lock/release
   * request in flight. Their "locked" state is ours, not another user's,
   * until the server answers (and broadcasts). A selected seat shows as held;
   * a dropped seat (release in flight) shows as available, so the map lets
   * the user pick it again at once and the controller re-locks it after the
   * release lands.
   */
  const { viewerSeatStates, viewerMyLockedSeatIds } = useMemo(() => {
    let seatStates: Map<string, RuntimeSeatState> | null = null;
    let myLocked = myLockedSeatIds;
    if (!currentSeatMap || !activeShowtimeId) {
      return { viewerSeatStates: seatStatesMap, viewerMyLockedSeatIds: myLocked };
    }
    for (const operation of seatLocks.pendingSeats) {
      if (operation.showtimeId !== activeShowtimeId) {
        continue;
      }
      const identity = parseRuntimeSeatIdentity(operation.seatKey);
      if (identity.floorKey !== currentSeatMap.floorKey) {
        continue;
      }
      const state = seatStatesMap.get(identity.seatKey) ?? seatStatesMap.get(identity.seatId);
      if (state !== 'locked') {
        continue;
      }
      if (selectedSeats.some((seat) => seat.seatKey === identity.seatKey)) {
        if (myLocked === myLockedSeatIds) myLocked = new Set(myLockedSeatIds);
        myLocked.add(identity.seatId);
      } else {
        seatStates ??= new Map(seatStatesMap);
        seatStates.set(identity.seatKey, 'available');
        seatStates.set(identity.seatId, 'available');
      }
    }
    return {
      viewerSeatStates: (seatStates ?? seatStatesMap) as FloorSeatStates,
      viewerMyLockedSeatIds: myLocked,
    };
  }, [activeShowtimeId, currentSeatMap, myLockedSeatIds, seatLocks.pendingSeats, seatStatesMap, selectedSeats]);

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
  const ticketLimitCopy = formatCopy(seatCopy.limit, { count: maxTicketsPerUser });
  const seatChangePolicyCopy = seatCopy.changePolicy;

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
    () => selectedSeats.reduce((sum, seat) => sum + seat.price, 0)
      + selectedSeats.length * TICKET_SERVICE_FEE_KRW,
    [selectedSeats],
  );

  const floorOptions = useMemo(() => {
    return availableSeatMaps.map((seatMap) => {
      const selectedCount = selectedSeats.filter((seat) => seat.floorKey === seatMap.floorKey).length;
      const floorStates = seatStatesByFloorKey.get(seatMap.floorKey);
      const seatIds = seatMap.seatConfig?.tiers.flatMap((tier) => tier.seatIds) ?? [];
      const availableSeats = seatIds.filter((seatId) => {
          const state = floorStates?.get(seatId) ?? 'available';
          return !isUnavailableSeatState(state);
        }).length;

      return {
        floorKey: seatMap.floorKey,
        floorLabel: seatMap.floorLabel,
        selectedCount,
        isSoldOut: seatIds.length > 0 && availableSeats === 0,
        totalSeats: seatMap.totalSeats,
        availableSeats,
      };
    });
  }, [availableSeatMaps, seatStatesByFloorKey, selectedSeats]);

  const currentFloorOption = floorOptions.find((option) => option.floorKey === currentSeatMap?.floorKey) ?? null;

  const buildSeatSelection = useCallback(
    (runtimeSeatId: string): FloorAwareSeatSelection | null => {
      const seatIdentity = parseRuntimeSeatIdentity(runtimeSeatId);
      const floorSeatMap = availableSeatMaps.find((seatMap) => seatMap.floorKey === seatIdentity.floorKey);
      const tierInfo = tierInfoByFloorKey.get(seatIdentity.floorKey)?.get(seatIdentity.seatId);
      if (!floorSeatMap || !tierInfo) {
        return null;
      }

      const parts = seatIdentity.seatId.split('-');
      return {
        seatId: seatIdentity.seatId,
        tierName: tierInfo.tierName,
        tierColor: tierInfo.color,
        row: parts[0] ?? seatIdentity.seatId,
        number: parts[1] ?? '',
        price: tierInfo.price,
        floorKey: floorSeatMap.floorKey,
        floorLabel: floorSeatMap.floorLabel,
        seatKey: seatIdentity.seatKey,
      };
    },
    [availableSeatMaps, tierInfoByFloorKey],
  );

  /**
   * Aligns the selection with the server's locks: drops selected seats the
   * server no longer holds for the user (lost lock responses, TTL expiry) and
   * restores held seats missing from the selection (reload, return from
   * checkout, a lock whose response was lost). Snapshots requested before the
   * last seat operation of that showtime was answered are ignored, so a
   * just-released seat is never restored from an old snapshot.
   */
  const lastReconciledRef = useRef<{ snapshot: MyLocksSnapshot; changed: boolean } | null>(null);
  const isCheckingExpiryRef = useRef(false);
  const reconcileSelectionWithServer = useCallback(
    (snapshot: MyLocksSnapshot, showtimeId: string): { applied: boolean; changed: boolean } => {
      if (lastReconciledRef.current?.snapshot === snapshot) {
        return { applied: true, changed: lastReconciledRef.current.changed };
      }
      if (!seatLocks.isSnapshotCurrent(snapshot.requestSeq ?? 0, showtimeId)) {
        return { applied: false, changed: false };
      }
      const state = useBookingStore.getState();
      if (state.selectedShowtimeId !== showtimeId) {
        return { applied: false, changed: false };
      }

      const serverSeatKeys = new Set(
        snapshot.seatIds.map((runtimeSeatId) => parseRuntimeSeatIdentity(runtimeSeatId).seatKey),
      );
      const hadSelection = state.selectedSeats.length > 0;
      const ghostSeats = state.selectedSeats.filter((seat) => !serverSeatKeys.has(seat.seatKey));
      for (const seat of ghostSeats) {
        removeSeat(seat.seatKey);
      }

      const selectedSeatKeys = new Set(state.selectedSeats.map((seat) => seat.seatKey));
      let restoredCount = 0;
      for (const runtimeSeatId of snapshot.seatIds) {
        const seatSelection = buildSeatSelection(runtimeSeatId);
        if (!seatSelection || selectedSeatKeys.has(seatSelection.seatKey)) {
          continue;
        }
        addSeat(seatSelection);
        restoredCount += 1;
      }

      if (snapshot.expiresAt && useBookingStore.getState().selectedSeats.length > 0) {
        setTimerExpiry(snapshot.expiresAt);
      }

      // A restore into an empty selection (reload/return) is expected and silent.
      const changed = ghostSeats.length > 0 || (hadSelection && restoredCount > 0);
      lastReconciledRef.current = { snapshot, changed };
      if (changed && !isCheckingExpiryRef.current) {
        toast.info(seatCopy.selectionResynced);
      }
      return { applied: true, changed };
    },
    [addSeat, buildSeatSelection, removeSeat, seatCopy.selectionResynced, seatLocks, setTimerExpiry],
  );

  const refetchedStaleSnapshotRef = useRef<MyLocksSnapshot | null>(null);
  useEffect(() => {
    if (!activeShowtimeId || !myLocksData) {
      return;
    }
    const { applied } = reconcileSelectionWithServer(myLocksData, activeShowtimeId);
    if (
      !applied
      && seatLocks.predatesMount(myLocksData.requestSeq ?? 0)
      && refetchedStaleSnapshotRef.current !== myLocksData
    ) {
      // Cached from an earlier visit, or a request from before this mount
      // that the mount refetch joined: ask the server again. A refetch
      // already running (the usual mount refetch) is reused.
      refetchedStaleSnapshotRef.current = myLocksData;
      void queryClient.invalidateQueries(
        { queryKey: ['my-locks', activeShowtimeId] },
        { cancelRefetch: false },
      );
    }
  }, [activeShowtimeId, myLocksData, queryClient, reconcileSelectionWithServer, seatLocks]);

  /**
   * Reads my-locks requested after this call and after every in-flight seat
   * operation settled. A refetch that was cancelled (a lock success patches
   * the cache meanwhile) resolves with the older cached snapshot; that is
   * not a server answer, so it is retried once. Null when no fresh snapshot
   * could be read.
   */
  const fetchFreshMyLocks = useCallback(async (): Promise<MyLocksSnapshot | null> => {
    const requestedAfterSeq = nextSeatSyncSequence();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await seatLocks.waitForIdle();
      const result = await refetchMyLocks();
      const snapshot = result?.data;
      if (!result?.isError && snapshot && (snapshot.requestSeq ?? 0) > requestedAfterSeq) {
        return snapshot;
      }
    }
    return null;
  }, [refetchMyLocks, seatLocks]);

  /**
   * Releases whatever the user may hold in a showtime they are leaving. When
   * its my-locks never loaded (left during the first load, or the load
   * failed), holds from before a reload are unknown, so lock-all is sent
   * anyway; it only releases the caller's own locks.
   */
  const releaseShowtimeHolds = useCallback(
    (showtimeId: string) => {
      const state = useBookingStore.getState();
      const cachedLocks = queryClient.getQueryData<MyLocksSnapshot>(['my-locks', showtimeId]);
      const holdsSeats = (state.selectedShowtimeId === showtimeId && state.selectedSeats.length > 0)
        || cachedLocks === undefined
        || cachedLocks.seatIds.length > 0
        || seatLocks.hasPendingLocksFor(showtimeId);
      if (holdsSeats) {
        seatLocks.releaseAll(showtimeId);
      }
    },
    [queryClient, seatLocks],
  );

  const changeShowtime = useCallback(
    (nextShowtimeId: string | null) => {
      const previousShowtimeId = useBookingStore.getState().selectedShowtimeId;
      if (previousShowtimeId === nextShowtimeId) {
        return;
      }
      if (previousShowtimeId) {
        releaseShowtimeHolds(previousShowtimeId);
      }
      setShowtime(nextShowtimeId);
      // Browser back from checkout must restore the buyer's latest choice,
      // rather than reapply the detail page's original showtime and release it.
      const url = new URL(window.location.href);
      if (url.pathname.endsWith(`/booking/${performanceId}`)) {
        if (nextShowtimeId) url.searchParams.set('showtimeId', nextShowtimeId);
        else url.searchParams.delete('showtimeId');
        // Next's history patch ignores state with __NA; null lets it update
        // useSearchParams and the auth/queue return URL along with the address bar.
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
    },
    [performanceId, releaseShowtimeHolds, setShowtime],
  );

  /** Sales close at the showtime start (`now >= date_time`): drop it and its seats. */
  const closeStartedShowtime = useCallback(
    (showtimeId: string) => {
      if (useBookingStore.getState().selectedShowtimeId !== showtimeId) {
        return;
      }
      releaseShowtimeHolds(showtimeId);
      setShowtime(null);
      toast.info(seatCopy.showtimeClosed);
    },
    [releaseShowtimeHolds, seatCopy.showtimeClosed, setShowtime],
  );

  // A selection that is not an open showtime of this performance (left over
  // from another performance, or the showtime started) is released and reset.
  useEffect(() => {
    if (!performance || !selectedShowtimeId || activeShowtimeId) {
      return;
    }
    if (allShowtimes.some((showtime) => showtime.id === selectedShowtimeId)) {
      closeStartedShowtime(selectedShowtimeId);
      return;
    }
    releaseShowtimeHolds(selectedShowtimeId);
    useBookingStore.getState().resetBooking();
  }, [
    activeShowtimeId,
    allShowtimes,
    closeStartedShowtime,
    performance,
    releaseShowtimeHolds,
    selectedShowtimeId,
  ]);

  const handleLockRejected = useCallback(({ error, showtimeId, stillWanted }: SeatLockRejection) => {
    if (isShowtimeSalesClosedError(error)) {
      closeStartedShowtime(showtimeId);
      return;
    }
    if (error instanceof ApiClientError && isQueueAccessRejection(error.statusCode, error.message)) {
      // The queue admission itself is gone (window over, used up by a purchase
      // in another tab): no seat can be locked here any more. Explain it in
      // the buyer's language and let the route move to the re-entry surface.
      toast.error(getQueueAccessClosedCopy(activeLocale).toast, { id: 'queue-access-rejected' });
      onQueueAccessRejected?.();
      return;
    }
    if (!stillWanted) {
      // The user already dropped this seat; nothing to report.
      return;
    }
    if (error instanceof BookingDisabledError) {
      toast.info(error.message);
      return;
    }
    if (error instanceof ApiClientError) {
      if (error.statusCode === 401) {
        return;
      }
      if (error.statusCode === 409) {
        toast.info(activeLocale === 'ko' ? error.message.trim() || seatCopy.selectionConflict : seatCopy.selectionConflict);
        return;
      }
      toast.error(
        activeLocale === 'ko' && error.message.trim()
          ? error.message
          : getStatusMessages()[error.statusCode] ?? getDefaultErrorMessage(),
      );
      return;
    }
    toast.error(copy.commonErrors.server);
  }, [
    activeLocale,
    closeStartedShowtime,
    copy.commonErrors.server,
    onQueueAccessRejected,
    seatCopy.selectionConflict,
  ]);

  useEffect(() => {
    lockRejectedHandlerRef.current = handleLockRejected;
  }, [handleLockRejected]);

  const handleSeatClick = useCallback(
    (runtimeSeatId: string) => {
      if (!activeShowtimeId || !activeShowtime || !currentSeatMap) {
        return;
      }
      if (!bookingAvailable) {
        toast.info(bookingDisabledMessage);
        return;
      }
      if (isShowtimeSalesClosed(activeShowtime.dateTime)) {
        closeStartedShowtime(activeShowtimeId);
        return;
      }

      const seatIdentity = parseRuntimeSeatIdentity(runtimeSeatId);
      const floorSeatMap = availableSeatMaps.find((seatMap) => seatMap.floorKey === seatIdentity.floorKey)
        ?? currentSeatMap;
      const floorSeatStates = seatStatesByFloorKeyRef.current.get(floorSeatMap.floorKey)
        ?? EMPTY_SEAT_STATES;
      const seatState = floorSeatStates.get(seatIdentity.seatKey) ?? floorSeatStates.get(seatIdentity.seatId);
      const existingSeat = selectedSeats.find(
        (seat) => seat.seatKey === seatIdentity.seatKey
          || (seat.floorKey === floorSeatMap.floorKey && seat.seatId === seatIdentity.seatId),
      );
      if (existingSeat) {
        seatLocks.releaseSeat(activeShowtimeId, existingSeat.seatKey);
        return;
      }

      // The user's own request for this seat is still running: its "locked"
      // state is ours, not another user's.
      const hasOwnPendingRequest = seatLocks.isLockPending(activeShowtimeId, seatIdentity.seatKey)
        || seatLocks.isUnlockPending(activeShowtimeId, seatIdentity.seatKey);
      const isMyLockedSeat = seatState === 'locked' && myLockedSeatIds.has(seatIdentity.seatId);
      if (isUnavailableSeatState(seatState) && !isMyLockedSeat && !hasOwnPendingRequest) {
        toast.info(seatCopy.seatTaken);
        return;
      }

      if (isMyLockedSeat && !hasOwnPendingRequest) {
        seatLocks.releaseSeat(activeShowtimeId, seatIdentity.seatKey);
        return;
      }

      if (selectedSeats.length >= maxTicketsPerUser) {
        toast.error(
          `${ticketLimitCopy}. ${seatCopy.releaseFirst}`,
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

      // Seats still being released count against the per-user limit on the
      // server until their release lands.
      seatLocks.lockSeat(activeShowtimeId, seatSelection, { perUserLimit: maxTicketsPerUser });
    },
    [
      seatCopy,
      activeShowtime,
      activeShowtimeId,
      availableSeatMaps,
      bookingDisabledMessage,
      bookingAvailable,
      closeStartedShowtime,
      currentSeatMap,
      maxTicketsPerUser,
      myLockedSeatIds,
      seatLocks,
      selectedSeats,
      ticketLimitCopy,
      tierInfoByFloorKey,
      tierInfoMap,
    ],
  );

  const handleRemoveSeat = useCallback(
    (seatKey: string) => {
      if (!activeShowtimeId) {
        return;
      }

      const seat = selectedSeats.find((selectedSeat) => selectedSeat.seatKey === seatKey);
      if (!seat) {
        return;
      }

      seatLocks.releaseSeat(activeShowtimeId, seat.seatKey);
    },
    [activeShowtimeId, seatLocks, selectedSeats],
  );

  const handleClearSeats = useCallback(() => {
    if (!activeShowtimeId || selectedSeats.length === 0) {
      return;
    }

    useBookingStore.getState().clearSeats();
    seatLocks.releaseAll(activeShowtimeId);
  }, [activeShowtimeId, seatLocks, selectedSeats.length]);

  const handleProceed = useCallback(async () => {
    if (!activeShowtimeId || !activeShowtime || !performance) {
      return;
    }
    if (!bookingAvailable) {
      toast.info(bookingDisabledMessage);
      return;
    }
    if (isShowtimeSalesClosed(activeShowtime.dateTime)) {
      closeStartedShowtime(activeShowtimeId);
      return;
    }

    // Hand off only seats the server still holds for this user, with the
    // server's deadline.
    const requestedSeatKeys = toSelectionKey(useBookingStore.getState().selectedSeats);
    setIsVerifyingSelection(true);
    try {
      const snapshot = await fetchFreshMyLocks();
      if (useBookingStore.getState().selectedShowtimeId !== activeShowtimeId) {
        return;
      }
      if (!snapshot) {
        toast.error(seatCopy.selectionVerifyFailed);
        return;
      }
      const { applied, changed } = reconcileSelectionWithServer(snapshot, activeShowtimeId);
      if (changed) {
        // The server no longer matches the selection (resync toast shown).
        return;
      }
      if (!applied) {
        // A seat was clicked while verifying, so this answer is already old.
        toast.error(seatCopy.selectionVerifyFailed);
        return;
      }

      const state = useBookingStore.getState();
      if (state.selectedSeats.length === 0 || toSelectionKey(state.selectedSeats) !== requestedSeatKeys) {
        // The user changed the selection while it was being verified.
        return;
      }

      useBookingStore.getState().setBookingData({
        selectedSeats: state.selectedSeats,
        showtimeId: activeShowtimeId,
        performanceId,
        performanceTitle: performance.title,
        showDateTime: activeShowtime.dateTime,
        venue: performance.venue?.name ?? null,
        posterUrl: performance.posterUrl ?? null,
        expiresAt: earliestDeadline(snapshot.expiresAt ?? state.timerExpiresAt, queueAccessExpiresAt),
        queueAccessExpiresAt,
      });

      router.push(
        getLocalizedPathname(`/booking/${performanceId}/confirm`, activeLocale),
      );
    } finally {
      setIsVerifyingSelection(false);
    }
  }, [
    activeLocale,
    activeShowtime,
    activeShowtimeId,
    bookingDisabledMessage,
    bookingAvailable,
    closeStartedShowtime,
    fetchFreshMyLocks,
    performance,
    performanceId,
    queueAccessExpiresAt,
    reconcileSelectionWithServer,
    router,
    seatCopy.selectionVerifyFailed,
  ]);

  const handleBack = useCallback(() => {
    router.push(
      getLocalizedPathname(`/performance/${performanceId}`, activeLocale),
    );
  }, [activeLocale, performanceId, router]);

  // The client countdown is only a projection of the server TTL. Before
  // declaring expiry (which releases everything), confirm with the server.
  const handleTimerExpire = useCallback(async () => {
    // Only a seat-lock expiry resets the selection. When the queue access
    // window closes first, the booking route swaps to the queue-expired screen.
    const lockExpiresAt = useBookingStore.getState().timerExpiresAt;
    if (
      lockExpiresAt === null ||
      (queueAccessExpiresAt !== null && queueAccessExpiresAt < lockExpiresAt)
    ) {
      return;
    }
    const showtimeId = useBookingStore.getState().selectedShowtimeId;
    if (showtimeId && showtimeId === activeShowtimeId) {
      // The expiry modal explains the outcome; the resync toast stays quiet.
      isCheckingExpiryRef.current = true;
      try {
        const snapshot = await fetchFreshMyLocks();
        if (snapshot) {
          // Process the snapshot here (silently) so the effect does not toast it later.
          reconcileSelectionWithServer(snapshot, showtimeId);
        }
        const serverExpiresAt = snapshot?.expiresAt ?? null;
        const state = useBookingStore.getState();
        if (state.selectedShowtimeId !== showtimeId) {
          return;
        }
        if (
          snapshot
          && snapshot.seatIds.length > 0
          && serverExpiresAt !== null
          && serverExpiresAt - getServerNowMs() > HOLD_EXPIRY_MARGIN_MS
          && state.selectedSeats.length > 0
        ) {
          setTimerExpiry(serverExpiresAt);
          return;
        }
      } catch {
        // Fall through to the expiry modal.
      } finally {
        isCheckingExpiryRef.current = false;
      }
    }
    useBookingStore.getState().expireTimer();
  }, [activeShowtimeId, fetchFreshMyLocks, queueAccessExpiresAt, reconcileSelectionWithServer, setTimerExpiry]);

  const handleTimerReset = useCallback(() => {
    const { selectedShowtimeId: showtimeId } = useBookingStore.getState();
    if (showtimeId) {
      seatLocks.releaseAll(showtimeId);
    }
    useBookingStore.getState().resetBooking();
  }, [seatLocks]);

  const handleDateSelect = useCallback(
    (date: Date) => {
      const currentDate = useBookingStore.getState().selectedDate;
      if (
        currentDate
        && currentDate.getFullYear() === date.getFullYear()
        && currentDate.getMonth() === date.getMonth()
        && currentDate.getDate() === date.getDate()
      ) {
        // Same day again: keep the showtime and its held seats.
        return;
      }
      setDate(date);
      changeShowtime(null);
    },
    [changeShowtime, setDate],
  );

  // A detail-page date choice is a preference, never a seat hold or queue bypass.
  // Only accept a still-bookable showtime owned by this performance and use the
  // existing transition, which releases any holds from the previous showtime.
  useEffect(() => {
    if (!performance || !initialShowtimeId || !bookingAvailable) return;
    const key = `${performanceId}:${initialShowtimeId}`;
    if (initialSelectionRef.current === key) return;
    initialSelectionRef.current = key;
    const selected = bookableShowtimes.find((show) => show.id === initialShowtimeId);
    if (!selected) return;
    setDate(getKstCalendarDate(selected.dateTime));
    changeShowtime(selected.id);
    setIsDatePickerOpen(false);
  }, [performance, performanceId, initialShowtimeId, bookingAvailable, bookableShowtimes, setDate, changeShowtime]);

  if (bookingDisabledReason) {
    const disabledTitle = performance?.title ?? seatCopy.bookingInfo;
    const backLabel = performance?.title ?? seatCopy.backToEvent;

    return (
      <div className="flex flex-1 flex-col">
        <BookingHeader
          performanceTitle={disabledTitle}
          expiresAt={null}
          onBack={handleBack}
          onExpire={() => {
            void handleTimerExpire();
          }}
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
        expiresAt={bookingDeadlineAt}
        onBack={handleBack}
        onExpire={() => {
          void handleTimerExpire();
        }}
      />

      <main className="mx-auto w-full max-w-[1440px] px-4 py-4 pb-72 lg:px-6 lg:pb-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <BookingProgress step={0} />
          <p className="text-xs text-gray-500">{performance.venue?.name}</p>
        </div>
        <section className="mb-4 overflow-hidden rounded-xl border border-border bg-white">
          <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
            onClick={() => setIsDatePickerOpen(!isDatePickerOpen)} aria-expanded={isDatePickerOpen}>
            <span className="text-sm font-semibold text-gray-900">{activeShowtime
              ? formatEventTimeWithKstAnchor(activeShowtime.dateTime, activeLocale, { includeLocalTime: false }).kst
              : seatCopy.dateShowtime}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-primary">{seatCopy.changeSchedule}<ChevronDown className={`size-4 ${isDatePickerOpen ? 'rotate-180' : ''}`} /></span>
          </button>
          {isDatePickerOpen ? <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-[minmax(240px,320px)_1fr]">
            <div><h2 className="mb-2 text-sm text-gray-700">{seatCopy.chooseDate}</h2>
              <DatePicker availableDates={availableDates} selected={selectedDate} onSelect={handleDateSelect} /></div>
            {selectedDate ? <div><h2 className="mb-2 text-sm text-gray-700">{seatCopy.chooseShowtime}</h2>
              <ShowtimeChips showtimes={filteredShowtimes} selected={activeShowtimeId} onSelect={(id) => {
                changeShowtime(id);
                if (id) setIsDatePickerOpen(false);
              }} /></div> : null}
          </div> : null}
        </section>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            {activeShowtimeId && currentSeatMap && seatConfig ? <>
              <div className="overflow-hidden rounded-xl border border-border bg-white">
                <FloorSelector floors={floorOptions} selectedFloorKey={currentSeatMap.floorKey}
                  onChange={(key) => { setSelectedFloorKey(key); setSectionFocus(null); }} />
                <SeatSectionSelector sections={seatConfig.sections ?? []}
                  selected={sectionFocus && sectionFocus.floorKey === currentSeatMap.floorKey ? sectionFocus.sectionKey : null}
                  onChange={(key) => setSectionFocus(key ? { floorKey: currentSeatMap.floorKey, sectionKey: key } : null)} seatStates={viewerSeatStates} />
                <SeatMapViewer svgUrl={currentSeatMap.svgUrl} floorKey={currentSeatMap.floorKey} floorLabel={currentSeatMap.floorLabel}
                  seatConfig={seatConfig} seatStates={viewerSeatStates} selectedSeatIds={selectedSeatIds} myLockedSeatIds={viewerMyLockedSeatIds}
                  onSeatClick={handleSeatClick} maxSelect={maxTicketsPerUser}
                  focusedSectionKey={sectionFocus && sectionFocus.floorKey === currentSeatMap.floorKey ? sectionFocus.sectionKey : null} />
              </div>
              <SeatLegend tiers={legendTiers} showExcluded />
              <section className="rounded-xl bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
                <p className="font-semibold text-gray-800">{ticketLimitCopy}</p><p>{seatChangePolicyCopy}</p>
                {currentFloorOption?.isSoldOut ? <p className="mt-1 font-semibold text-amber-800">{seatCopy.noFloorSeats}</p> : null}
              </section>
            </> : null}
          </div>
          {activeShowtimeId ? <BookingSelectionBar tierSummaries={tierSummaries} seats={sortedSelections} onRemove={handleRemoveSeat}
            selectedSeatCount={selectedSeats.length} totalPrice={totalPrice} canClear={selectedSeats.length > 0}
            onClear={handleClearSeats} onProceed={() => { void handleProceed(); }}
            isLoading={seatLocks.pendingLockCount > 0 || seatLocks.isReleasingAll || isVerifyingSelection} disabledReason={bookingDisabledReason} /> : null}
        </div>
      </main>

      <TimerExpiredModal open={isTimerExpired} onReset={handleTimerReset} />
    </div>
  );
}
