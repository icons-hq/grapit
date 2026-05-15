'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SeatMapConfig } from '@grabit/shared';
import { sanitizeParsedSvg } from '@/lib/svg/safety';

type SeatTier = SeatMapConfig['tiers'][number];

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface VisualSeatTierEditorProps {
  svgMarkup: string;
  tiers: SeatMapConfig['tiers'];
  onChange: (tiers: SeatMapConfig['tiers']) => void;
}

interface SeatAssignmentStats {
  seatIds: string[];
  assignedKnownCount: number;
  duplicateSeatIds: string[];
  unknownSeatIds: string[];
  unassignedCount: number;
}

function parseSvg(svgMarkup: string, tiers: SeatTier[]) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  if (
    doc.documentElement.tagName === 'parsererror' ||
    doc.querySelector('parsererror')
  ) {
    return null;
  }
  sanitizeParsedSvg(doc);

  const seatIds = Array.from(doc.querySelectorAll('[data-seat-id]'))
    .map((el) => el.getAttribute('data-seat-id')?.trim())
    .filter((seatId): seatId is string => Boolean(seatId));
  const uniqueSeatIds = Array.from(new Set(seatIds));
  const seatIdSet = new Set(uniqueSeatIds);
  const assignments = new Map<string, SeatTier[]>();

  tiers.forEach((tier) => {
    tier.seatIds.forEach((seatId) => {
      const trimmed = seatId.trim();
      if (!trimmed) return;
      assignments.set(trimmed, [...(assignments.get(trimmed) ?? []), tier]);
    });
  });

  const duplicateSeatIds = Array.from(assignments.entries())
    .filter(([, assignedTiers]) => assignedTiers.length > 1)
    .map(([seatId]) => seatId);
  const unknownSeatIds = Array.from(assignments.keys()).filter(
    (seatId) => !seatIdSet.has(seatId),
  );
  const assignedKnownCount = Array.from(assignments.keys()).filter((seatId) =>
    seatIdSet.has(seatId),
  ).length;

  doc.querySelectorAll<SVGElement>('[data-seat-id]').forEach((el) => {
    const seatId = el.getAttribute('data-seat-id')?.trim();
    if (!seatId) return;
    const assignedTiers = assignments.get(seatId) ?? [];
    const tier = assignedTiers[0];
    const isDuplicate = assignedTiers.length > 1;

    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${seatId} 좌석`);
    el.setAttribute(
      'style',
      'cursor:pointer;transition:fill 120ms ease,stroke 120ms ease;',
    );

    if (isDuplicate) {
      el.setAttribute('fill', '#F59E0B');
      el.setAttribute('stroke', '#92400E');
      el.setAttribute('stroke-width', '3');
    } else if (tier) {
      el.setAttribute('fill', tier.color);
      el.setAttribute('stroke', '#111827');
      el.setAttribute('stroke-width', '2');
    } else {
      el.setAttribute('fill', el.getAttribute('fill') ?? '#E5E7EB');
      el.setAttribute('stroke', el.getAttribute('stroke') ?? '#CBD5E1');
      el.setAttribute('stroke-width', el.getAttribute('stroke-width') ?? '1');
    }
  });

  const svgEl = doc.documentElement;
  if (!svgEl.getAttribute('viewBox')) {
    const width = svgEl.getAttribute('width') || '800';
    const height = svgEl.getAttribute('height') || '600';
    svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
  svgEl.setAttribute('style', 'width:100%;height:auto;display:block;');

  return {
    processedSvg: svgEl.outerHTML,
    stats: {
      seatIds: uniqueSeatIds,
      assignedKnownCount,
      duplicateSeatIds,
      unknownSeatIds,
      unassignedCount: Math.max(uniqueSeatIds.length - assignedKnownCount, 0),
    } satisfies SeatAssignmentStats,
  };
}

function assignSeatToTier(
  tiers: SeatMapConfig['tiers'],
  activeTierIndex: number,
  seatId: string,
) {
  return tiers.map((tier, index) => {
    const nextSeatIds = tier.seatIds.filter((id) => id !== seatId);
    if (index !== activeTierIndex) {
      return { ...tier, seatIds: nextSeatIds };
    }

    const wasAlreadyAssigned = tier.seatIds.includes(seatId);
    return {
      ...tier,
      seatIds: wasAlreadyAssigned ? nextSeatIds : [...nextSeatIds, seatId],
    };
  });
}

function paintSeatsToTier(
  tiers: SeatMapConfig['tiers'],
  activeTierIndex: number,
  seatIds: string[],
) {
  const paintedSeatIds = new Set(seatIds);

  return tiers.map((tier, index) => {
    const nextSeatIds = tier.seatIds.filter((id) => !paintedSeatIds.has(id));

    if (index !== activeTierIndex) {
      return { ...tier, seatIds: nextSeatIds };
    }

    return {
      ...tier,
      seatIds: Array.from(new Set([...nextSeatIds, ...seatIds])),
    };
  });
}

function findSeatElementFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest('[data-seat-id]');
}

function findSeatIdFromTarget(target: EventTarget | null) {
  return findSeatElementFromTarget(target)?.getAttribute('data-seat-id') ?? null;
}

function createSelectionRect(
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
  containerRect: DOMRect,
): SelectionRect {
  const left = Math.min(startPoint.x, endPoint.x);
  const top = Math.min(startPoint.y, endPoint.y);
  const right = Math.max(startPoint.x, endPoint.x);
  const bottom = Math.max(startPoint.y, endPoint.y);

  return {
    left: left - containerRect.left,
    top: top - containerRect.top,
    width: right - left,
    height: bottom - top,
  };
}

function selectionToClientRect(
  selectionRect: SelectionRect,
  containerRect: DOMRect,
) {
  return {
    left: containerRect.left + selectionRect.left,
    top: containerRect.top + selectionRect.top,
    right: containerRect.left + selectionRect.left + selectionRect.width,
    bottom: containerRect.top + selectionRect.top + selectionRect.height,
  };
}

function rectsIntersect(
  left: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  right: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
) {
  return (
    left.left <= right.right &&
    left.right >= right.left &&
    left.top <= right.bottom &&
    left.bottom >= right.top
  );
}

export function VisualSeatTierEditor({
  svgMarkup,
  tiers,
  onChange,
}: VisualSeatTierEditorProps) {
  const [activeTierIndex, setActiveTierIndex] = useState(0);
  const [isRangeSelectEnabled, setIsRangeSelectEnabled] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const isSelectingRef = useRef(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const latestSelectionRef = useRef<SelectionRect | null>(null);
  const parsed = useMemo(() => parseSvg(svgMarkup, tiers), [svgMarkup, tiers]);
  const activeTier = tiers[activeTierIndex] ?? tiers[0];

  function handleSeatPick(seatId: string | null) {
    if (!seatId || !activeTier) {
      return;
    }
    onChange(assignSeatToTier(tiers, activeTierIndex, seatId));
  }

  function beginRangeSelection(clientX: number, clientY: number) {
    if (!isRangeSelectEnabled || !activeTier || !gridRef.current) {
      return false;
    }

    const startPoint = { x: clientX, y: clientY };
    const initialRect = createSelectionRect(
      startPoint,
      startPoint,
      gridRef.current.getBoundingClientRect(),
    );
    isSelectingRef.current = true;
    selectionStartRef.current = startPoint;
    latestSelectionRef.current = initialRect;
    setSelectionRect(initialRect);
    return true;
  }

  function updateRangeSelection(clientX: number, clientY: number) {
    if (
      !isRangeSelectEnabled ||
      !isSelectingRef.current ||
      !selectionStartRef.current ||
      !gridRef.current
    ) {
      return;
    }

    const nextSelectionRect = createSelectionRect(
      selectionStartRef.current,
      { x: clientX, y: clientY },
      gridRef.current.getBoundingClientRect(),
    );
    latestSelectionRef.current = nextSelectionRect;
    setSelectionRect(nextSelectionRect);
  }

  function commitRangeSelection() {
    if (!isSelectingRef.current) {
      return;
    }

    const gridEl = gridRef.current;
    const currentSelectionRect = latestSelectionRef.current;
    isSelectingRef.current = false;
    selectionStartRef.current = null;
    latestSelectionRef.current = null;
    setSelectionRect(null);

    if (!gridEl || !activeTier || !currentSelectionRect) {
      return;
    }

    const selectionClientRect = selectionToClientRect(
      currentSelectionRect,
      gridEl.getBoundingClientRect(),
    );
    const selectedSeatIds = Array.from(
      gridEl.querySelectorAll<SVGElement>('[data-seat-id]'),
    )
      .filter((seatEl) =>
        rectsIntersect(seatEl.getBoundingClientRect(), selectionClientRect),
      )
      .map((seatEl) => seatEl.getAttribute('data-seat-id')?.trim())
      .filter((seatId): seatId is string => Boolean(seatId));

    if (selectedSeatIds.length === 0) {
      return;
    }

    onChange(paintSeatsToTier(tiers, activeTierIndex, selectedSeatIds));
  }

  function cancelRangeSelection() {
    isSelectingRef.current = false;
    selectionStartRef.current = null;
    latestSelectionRef.current = null;
    setSelectionRect(null);
  }

  useEffect(() => {
    window.addEventListener('pointerup', commitRangeSelection);
    window.addEventListener('pointercancel', cancelRangeSelection);
    window.addEventListener('mouseup', commitRangeSelection);

    return () => {
      window.removeEventListener('pointerup', commitRangeSelection);
      window.removeEventListener('pointercancel', cancelRangeSelection);
      window.removeEventListener('mouseup', commitRangeSelection);
    };
  });

  if (!parsed) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        SVG를 시각 편집기로 불러오지 못했습니다. 아래 직접 입력으로 좌석 ID를
        확인해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-white p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div
            ref={gridRef}
            role="grid"
            aria-label="등급 배정 좌석맵"
            className={`relative max-h-[460px] overflow-auto rounded-md border bg-gray-50 p-3 ${
              isRangeSelectEnabled ? 'cursor-crosshair select-none' : ''
            }`}
            onClick={(event) => {
              if (isRangeSelectEnabled) {
                return;
              }
              handleSeatPick(findSeatIdFromTarget(event.target));
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              handleSeatPick(findSeatIdFromTarget(event.target));
            }}
            onPointerDown={(event) => {
              if (!beginRangeSelection(event.clientX, event.clientY)) {
                return;
              }

              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              updateRangeSelection(event.clientX, event.clientY);
            }}
            onPointerUp={commitRangeSelection}
            onPointerCancel={cancelRangeSelection}
            onMouseDown={(event) => {
              if (beginRangeSelection(event.clientX, event.clientY)) {
                event.preventDefault();
              }
            }}
            onMouseMove={(event) => {
              updateRangeSelection(event.clientX, event.clientY);
            }}
            onMouseUp={() => {
              commitRangeSelection();
            }}
          >
            <div dangerouslySetInnerHTML={{ __html: parsed.processedSvg }} />
            {selectionRect && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border border-primary bg-primary/15"
                style={{
                  left: selectionRect.left,
                  top: selectionRect.top,
                  width: selectionRect.width,
                  height: selectionRect.height,
                }}
              />
            )}
          </div>
        </div>

        <div className="w-full space-y-3 lg:w-64">
          <div>
            <label
              htmlFor="visual-seat-tier-active"
              className="text-xs font-medium text-gray-600"
            >
              클릭 배정 등급
            </label>
            <select
              id="visual-seat-tier-active"
              value={activeTierIndex}
              onChange={(event) => setActiveTierIndex(Number(event.target.value))}
              className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
            >
              {tiers.map((tier, index) => (
                <option key={`${tier.tierName}-${index}`} value={index}>
                  {tier.tierName || `등급 ${index + 1}`}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-md border bg-gray-50 px-3 py-2 text-sm">
            <span className="font-medium text-gray-700">범위 배정</span>
            <input
              type="checkbox"
              checked={isRangeSelectEnabled}
              onChange={(event) => {
                setIsRangeSelectEnabled(event.target.checked);
                cancelRangeSelection();
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
          </label>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-gray-50 p-2">
              <div className="text-xs text-gray-500">SVG 좌석</div>
              <div className="font-semibold">{parsed.stats.seatIds.length}개</div>
            </div>
            <div className="rounded-md bg-gray-50 p-2">
              <div className="text-xs text-gray-500">미배정</div>
              <div className="font-semibold">{parsed.stats.unassignedCount}개</div>
            </div>
            <div className="rounded-md bg-gray-50 p-2">
              <div className="text-xs text-gray-500">중복 배정</div>
              <div className="font-semibold">
                {parsed.stats.duplicateSeatIds.length}개
              </div>
            </div>
            <div className="rounded-md bg-gray-50 p-2">
              <div className="text-xs text-gray-500">SVG에 없음</div>
              <div className="font-semibold">
                {parsed.stats.unknownSeatIds.length}개
              </div>
            </div>
          </div>

          {(parsed.stats.duplicateSeatIds.length > 0 ||
            parsed.stats.unknownSeatIds.length > 0) && (
            <div
              role="alert"
              className="rounded-md bg-red-50 p-2 text-xs text-red-700"
            >
              {parsed.stats.duplicateSeatIds.length > 0 && (
                <p>중복: {parsed.stats.duplicateSeatIds.join(', ')}</p>
              )}
              {parsed.stats.unknownSeatIds.length > 0 && (
                <p>SVG에 없는 좌석: {parsed.stats.unknownSeatIds.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
