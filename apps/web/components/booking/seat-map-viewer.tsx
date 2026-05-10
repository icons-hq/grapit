'use client';

import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { TransformWrapper, TransformComponent, MiniMap } from 'react-zoom-pan-pinch';
import { Loader2, RefreshCw } from 'lucide-react';
import type { SeatMapConfig, SeatState } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SeatMapControls } from './seat-map-controls';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { prefixSvgDefsIds } from './__utils__/prefix-svg-defs-ids';
import { sanitizeParsedSvg } from '@/lib/svg/safety';

interface SeatMapViewerProps {
  svgUrl: string;
  seatConfig: SeatMapConfig;
  seatStates: Map<string, SeatState>;
  selectedSeatIds: Set<string>;
  onSeatClick: (seatId: string) => void;
  maxSelect: number;
}

const LOCKED_COLOR = '#D1D5DB';
const SELECTED_STROKE = '#1A1A2E';
const SEAT_OVERLAY_ATTR = 'data-seat-overlay-for';

function normalizeSeatLabelOverlays(doc: Document) {
  const seatParents = new Set<Element>();
  doc.querySelectorAll('[data-seat-id]').forEach((seatEl) => {
    if (seatEl.parentElement) {
      seatParents.add(seatEl.parentElement);
    }
  });

  seatParents.forEach((parent) => {
    const seatChildren = Array.from(parent.children).filter((child) =>
      child.hasAttribute('data-seat-id')
    );
    if (seatChildren.length !== 1) {
      return;
    }

    const seatId = seatChildren[0]?.getAttribute('data-seat-id');
    if (!seatId) {
      return;
    }

    Array.from(parent.children).forEach((child) => {
      if (child === seatChildren[0]) {
        return;
      }

      if (child.hasAttribute('data-seat-checkmark')) {
        return;
      }

      const overlayTexts = child.matches('text, tspan')
        ? [child]
        : Array.from(child.querySelectorAll('text, tspan'));

      overlayTexts.forEach((overlayText) => {
        if (overlayText.hasAttribute('data-seat-checkmark')) {
          return;
        }

        overlayText.setAttribute(SEAT_OVERLAY_ATTR, seatId);
        overlayText.setAttribute('pointer-events', 'none');
      });
    });
  });
}

function findSeatElementById(container: ParentNode | null, seatId: string) {
  if (!container) {
    return null;
  }

  return Array.from(container.querySelectorAll<SVGElement>('[data-seat-id]')).find(
    (element) => element.getAttribute('data-seat-id') === seatId,
  ) ?? null;
}

export function SeatMapViewer({
  svgUrl,
  seatConfig,
  seatStates,
  selectedSeatIds,
  onSeatClick,
  maxSelect,
}: SeatMapViewerProps) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [rawSvg, setRawSvg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // reviews revision HIGH #1: per-seat timeout Map — rapid reselect race guard
  const prevSelectedRef = useRef<Set<string>>(new Set());
  const timeoutsRef = useRef<Map<string, number>>(new Map());
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(
    new Set(),
  );

  // selectedSeatIds 변경 감지 → 해제/재선택 per-seat 처리
  // review WR-01: pendingRemovals는 함수형 업데이트 안에서만 읽어 deps에서 제거.
  //   self-triggering effect로 인한 불필요한 재실행(+ prevSelectedRef 재할당) 방지.
  useEffect(() => {
    const prev = prevSelectedRef.current;
    const curr = selectedSeatIds;

    // 재선택: curr에 있고 prev에 없는 seat → 기존 timeout clear + pending 제거
    curr.forEach((id) => {
      if (!prev.has(id)) {
        // 이 seat가 이전에 해제 중(pending)이었다면 즉시 취소
        const existing = timeoutsRef.current.get(id);
        if (existing !== undefined) {
          clearTimeout(existing);
          timeoutsRef.current.delete(id);
        }
        // pendingRemovals 여부는 함수형 업데이트 안에서 체크 → deps 제거 가능
        setPendingRemovals((prevSet) => {
          if (!prevSet.has(id)) return prevSet;
          const next = new Set(prevSet);
          next.delete(id);
          return next;
        });
      }
    });

    // 해제: prev에 있고 curr에 없는 seat → per-seat setTimeout 150ms 등록
    prev.forEach((id) => {
      if (!curr.has(id)) {
        // 이미 pending이고 timeout이 존재하면 그대로 두기 (중복 등록 방지)
        if (timeoutsRef.current.has(id)) return;
        // pending에 추가
        setPendingRemovals((prevSet) => {
          const next = new Set(prevSet);
          next.add(id);
          return next;
        });
        const tid = window.setTimeout(() => {
          setPendingRemovals((prevSet) => {
            const next = new Set(prevSet);
            next.delete(id);
            return next;
          });
          timeoutsRef.current.delete(id);
        }, 150);
        timeoutsRef.current.set(id, tid);
      }
    });

    // prevSelectedRef 동기 갱신 (diff 계산 직후)
    prevSelectedRef.current = new Set(curr);
  }, [selectedSeatIds]);

  // 컴포넌트 unmount 시 남은 timeout 전부 clear
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((tid) => clearTimeout(tid));
      timeouts.clear();
    };
  }, []);

  // Build tier color map from seatConfig
  const tierColorMap = useMemo(() => {
    const map = new Map<string, { tierName: string; color: string }>();
    for (const tier of seatConfig.tiers) {
      for (const seatId of tier.seatIds) {
        map.set(seatId, { tierName: tier.tierName, color: tier.color });
      }
    }
    return map;
  }, [seatConfig]);

  // Fetch raw SVG
  useEffect(() => {
    if (!svgUrl) return;
    setIsLoading(true);
    setError(null);

    fetch(svgUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch SVG');
        return res.text();
      })
      .then((text) => {
        setRawSvg(text);
        setIsLoading(false);
      })
      .catch(() => {
        setError('좌석 배치도를 불러오지 못했습니다. 새로고침해주세요.');
        setIsLoading(false);
      });
  }, [svgUrl]);

  // Pre-process SVG string with colors baked in — survives re-renders
  const processedSvg = useMemo(() => {
    if (!rawSvg) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    // review WR-03: admin/prefix-svg-defs-ids와 통일된 parsererror 가드.
    //   R2가 손상된 SVG 또는 CDN 에러 페이지(HTML)를 반환한 엣지 케이스에서
    //   viewer가 parsererror 문서를 그대로 rendering하지 않도록 fallback 분기로 유도.
    if (
      doc.documentElement.tagName === 'parsererror' ||
      doc.querySelector('parsererror')
    ) {
      return null;
    }
    sanitizeParsedSvg(doc);
    const seats = doc.querySelectorAll('[data-seat-id]');

    seats.forEach((el) => {
      const seatId = el.getAttribute('data-seat-id');
      if (!seatId) return;

      const tierInfo = tierColorMap.get(seatId);
      const state = seatStates.get(seatId) ?? 'available';
      const isSelected = selectedSeatIds.has(seatId);
      const isRemoving = pendingRemovals.has(seatId);
      const showCheckmark = isSelected || isRemoving;

      // reviews revision MED #4 D-13 BROADCAST PRIORITY: locked/sold가 선택보다 우선
      // — broadcast 즉시 회색 + transition:none 유지. useMemo에서 LOCKED_COLOR 박아두고
      // Task 3 useEffect는 seatStates 체크로 primary 색 변경 skip.
      if (state === 'locked' || state === 'sold') {
        el.setAttribute('fill', LOCKED_COLOR);
        el.removeAttribute('stroke');
        el.setAttribute('stroke-width', '0');
        el.setAttribute('style', 'cursor:not-allowed;opacity:0.6;transition:none');
      } else if (showCheckmark && tierInfo) {
        // B-2-RESIDUAL-V2 Option C: useMemo는 *기본 tier 색상*만. fill primary 변경은 Task 3 useEffect.
        el.setAttribute('fill', tierInfo.color);
        el.setAttribute('stroke', SELECTED_STROKE);
        el.setAttribute('stroke-width', '3');
        el.setAttribute('data-tier-id', tierInfo.tierName);
        el.setAttribute('style', 'cursor:pointer;opacity:1;');

        // Inject white checkmark centered on seat
        const svgNs = 'http://www.w3.org/2000/svg';
        const checkEl = doc.createElementNS(svgNs, 'text');
        let cx: number | null = null;
        let cy: number | null = null;
        const tagName = el.tagName.toLowerCase();

        if (tagName === 'rect') {
          const rx = parseFloat(el.getAttribute('x') ?? '0');
          const ry = parseFloat(el.getAttribute('y') ?? '0');
          const rw = parseFloat(el.getAttribute('width') ?? '0');
          const rh = parseFloat(el.getAttribute('height') ?? '0');
          cx = rx + rw / 2;
          cy = ry + rh / 2;
        } else if (tagName === 'circle') {
          cx = parseFloat(el.getAttribute('cx') ?? '0');
          cy = parseFloat(el.getAttribute('cy') ?? '0');
        }

        if (cx !== null && cy !== null) {
          checkEl.setAttribute('x', String(cx));
          checkEl.setAttribute('y', String(cy));
          checkEl.setAttribute('text-anchor', 'middle');
          checkEl.setAttribute('dominant-baseline', 'central');
          checkEl.setAttribute('fill', 'white');
          checkEl.setAttribute('font-size', '12');
          checkEl.setAttribute('font-weight', 'bold');
          checkEl.setAttribute('pointer-events', 'none');
          // D-12 mount fade-in — CSS @keyframes (globals.css Plan 12-01)
          checkEl.setAttribute('data-seat-checkmark', '');
          // 해제 중: data-fading-out="true" 부여 → 150ms 후 Map에서 pending 제거
          if (isRemoving && !isSelected) {
            checkEl.setAttribute('data-fading-out', 'true');
          }
          checkEl.textContent = '✓';
          el.parentNode?.insertBefore(checkEl, el.nextSibling);
        }
      } else if (tierInfo) {
        el.setAttribute('fill', tierInfo.color);
        el.setAttribute('data-tier-id', tierInfo.tierName);
        el.removeAttribute('stroke');
        el.setAttribute('stroke-width', '0');
        el.setAttribute('style', 'cursor:pointer;opacity:1;transition:none');
      }
    });

    // Ensure viewBox exists (required — without it SVG disappears when width/height are removed)
    const svgEl = doc.documentElement;
    if (!svgEl.getAttribute('viewBox')) {
      const w = svgEl.getAttribute('width') || '800';
      const h = svgEl.getAttribute('height') || '600';
      svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    // reviews revision HIGH #2 + W-1: unified parsing contract — descendant [data-stage] + VALID_STAGES enum
    // reviews revision LOW #8: viewBox split(/[\s,]+/) + [minX, minY, width, height] 모두 사용
    // ⚠ in-memory `doc`에만 적용 — R2 원본 SVG 파일은 변경하지 않음 (D-19 호환)
    const VALID_STAGES = ['top', 'right', 'bottom', 'left'] as const;
    type ValidStage = (typeof VALID_STAGES)[number];
    const hasStageText = Array.from(doc.querySelectorAll('text')).some(
      (t) => t.textContent?.trim() === 'STAGE',
    );
    // UNIFIED CONTRACT: root + descendant 모두 탐색
    const stageEl = doc.querySelector('[data-stage]');
    const rawStageValue = stageEl?.getAttribute('data-stage') ?? null;
    // enum 검증 + default top fallback (admin에서 이미 걸러지지만 viewer 방어적 코드)
    const dataStage: ValidStage | null =
      rawStageValue && (VALID_STAGES as readonly string[]).includes(rawStageValue)
        ? (rawStageValue as ValidStage)
        : rawStageValue !== null
          ? 'top'
          : null;

    if (!hasStageText && dataStage) {
      // reviews revision LOW #8: viewBox가 whitespace OR comma separated, [minX, minY, width, height] 모두 사용
      const viewBoxAttr = svgEl.getAttribute('viewBox') ?? '0 0 800 600';
      const viewBoxValues = viewBoxAttr.split(/[\s,]+/).map(Number);
      const vbMinX = viewBoxValues[0] ?? 0;
      const vbMinY = viewBoxValues[1] ?? 0;
      const vbW = viewBoxValues[2] ?? 800;
      const vbH = viewBoxValues[3] ?? 600;
      const svgNs = 'http://www.w3.org/2000/svg';
      const overlayG = doc.createElementNS(svgNs, 'g');
      overlayG.setAttribute('aria-label', `무대 위치: ${dataStage}`);
      const badgeRect = doc.createElementNS(svgNs, 'rect');
      const badgeText = doc.createElementNS(svgNs, 'text');
      const badgeWidth = 120;
      const badgeHeight = 32;
      let bx = 0;
      let by = 0;
      // viewBox minX/minY 반영: 배지 위치는 [vbMinX, vbMinX + vbW] × [vbMinY, vbMinY + vbH] 범위 안에 계산
      switch (dataStage) {
        case 'top':
          bx = vbMinX + vbW / 2 - badgeWidth / 2;
          by = vbMinY + 12;
          break;
        case 'bottom':
          bx = vbMinX + vbW / 2 - badgeWidth / 2;
          by = vbMinY + vbH - badgeHeight - 12;
          break;
        case 'left':
          bx = vbMinX + 12;
          by = vbMinY + vbH / 2 - badgeHeight / 2;
          break;
        case 'right':
          bx = vbMinX + vbW - badgeWidth - 12;
          by = vbMinY + vbH / 2 - badgeHeight / 2;
          break;
      }
      badgeRect.setAttribute('x', String(bx));
      badgeRect.setAttribute('y', String(by));
      badgeRect.setAttribute('width', String(badgeWidth));
      badgeRect.setAttribute('height', String(badgeHeight));
      badgeRect.setAttribute('rx', '8');
      badgeRect.setAttribute('fill', '#E5E7EB');
      badgeRect.setAttribute('stroke', '#9CA3AF');
      badgeRect.setAttribute('stroke-width', '1.5');
      badgeText.setAttribute('x', String(bx + badgeWidth / 2));
      badgeText.setAttribute('y', String(by + badgeHeight / 2));
      badgeText.setAttribute('text-anchor', 'middle');
      badgeText.setAttribute('dominant-baseline', 'central');
      badgeText.setAttribute('font-size', '14');
      badgeText.setAttribute('font-weight', '600');
      badgeText.setAttribute('fill', '#6B7280');
      badgeText.textContent = 'STAGE';
      overlayG.appendChild(badgeRect);
      overlayG.appendChild(badgeText);
      svgEl.appendChild(overlayG);
    }

    normalizeSeatLabelOverlays(doc);

    // Remove fixed dimensions and make responsive
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.setAttribute('style', 'width:100%;height:auto;display:block;');

    return doc.documentElement.outerHTML;
  }, [rawSvg, seatStates, selectedSeatIds, tierColorMap, pendingRemovals]);

  // B-2-RESIDUAL-V2 Option C (reviews revision MED #4 D-13 BROADCAST PRIORITY):
  // dangerouslySetInnerHTML이 SVG를 재마운트한 *직후* 동일 element의 fill을 변경.
  // useMemo가 outerHTML 전체를 string으로 반환 → React가 자식 DOM을 unmount/remount
  //   → 새 rect는 mount 시점부터 tier 색이 박혀 *이전→새 값* 변화가 없음 → CSS `transition: fill 150ms` 무효.
  // 권장 패턴 (RESEARCH §Pitfall 3): 마운트 후 useEffect가 *동일 element의 속성*을 변경 → CSS transition 정상 발화.
  //
  // reviews revision MED #4 D-13 BROADCAST PRIORITY:
  //   selectedSeatIds 안의 좌석이 broadcast로 locked/sold로 전환된 경우,
  //   useEffect가 primary 색으로 덮어쓰면 D-13의 "broadcast 즉시 회색" 정책 침해.
  //   → seatStates.get(seatId) === 'locked' | 'sold'이면 skip.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !processedSvg) return;
    const root = container.querySelector('svg');
    if (!root) return;

    // 선택 좌석: fill을 primary로 변경 + transition 부여
    // 단 D-13: locked/sold 상태는 skip (broadcast 우선)
    selectedSeatIds.forEach((seatId) => {
      const state = seatStates.get(seatId);
      if (state === 'locked' || state === 'sold') {
        // reviews revision MED #4: useMemo가 이미 LOCKED_COLOR + transition:none으로 박아둠.
        // useEffect는 건드리지 않음 → D-13 broadcast 즉시 회색 정책 유지.
        return;
      }
      const el = findSeatElementById(root, seatId);
      if (!el) return;
      el.style.transition = 'fill 150ms ease-out, stroke 150ms ease-out';
      el.setAttribute('fill', '#6C3CE0'); // Brand Purple — D-03
    });

    // 해제 중인 좌석: fill을 원래 tier 색상으로 복원 + transition 유지
    pendingRemovals.forEach((seatId) => {
      const el = findSeatElementById(root, seatId);
      if (!el) return;
      el.style.transition = 'fill 150ms ease-out, stroke 150ms ease-out';
      const originalFill = tierColorMap.get(seatId)?.color ?? LOCKED_COLOR;
      el.setAttribute('fill', originalFill);
    });
  }, [selectedSeatIds, pendingRemovals, tierColorMap, seatStates, processedSvg]);

  // Event delegation for seat clicks
  // review WR-02 + IN-01: maxSelect prop을 viewer 내부에서 방어적으로 사용.
  //   상위(booking-page)가 MAX_SEATS를 주요 검증하지만, viewer에서도 double-defense로
  //   "선택되지 않은 좌석"을 새로 누를 때만 한도 검사를 건다. 선택된 좌석 해제는 항상 허용.
  //   deps에 selectedSeatIds.size와 selectedSeatIds.has가 실제 사용되므로 유지.
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest<SVGElement>(
        `[data-seat-id],[${SEAT_OVERLAY_ATTR}]`,
      );
      if (!target) return;

      const seatId = target.getAttribute('data-seat-id')
        ?? target.getAttribute(SEAT_OVERLAY_ATTR);
      if (!seatId) return;

      const state = seatStates.get(seatId) ?? 'available';
      if (state === 'sold') return;
      // PR18-CR-MAXSELECT-LOCKED: locked는 maxSelect 우회하여 parent에 위임 (D-13 invariant), available 한도만 차단
      if (
        state !== 'locked' &&
        !selectedSeatIds.has(seatId) &&
        selectedSeatIds.size >= maxSelect
      ) {
        return;
      }
      onSeatClick(seatId);
    },
    [seatStates, selectedSeatIds, onSeatClick, maxSelect],
  );

  // Hover tooltip — uses refs only, no state changes, no re-renders
  const handleMouseOver = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest<SVGElement>(
        `[data-seat-id],[${SEAT_OVERLAY_ATTR}]`,
      );
      if (!target) {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        return;
      }

      const seatId = target.getAttribute('data-seat-id')
        ?? target.getAttribute(SEAT_OVERLAY_ATTR);
      if (!seatId) return;

      const seatElement = target.hasAttribute('data-seat-id')
        ? target
        : findSeatElementById(containerRef.current, seatId);
      if (!seatElement) return;

      const state = seatStates.get(seatId) ?? 'available';
      if (state !== 'available' && !selectedSeatIds.has(seatId)) {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        return;
      }

      const tierInfo = tierColorMap.get(seatId);
      if (!tierInfo) return;

      const parts = seatId.split('-');
      const row = parts[0] ?? seatId;
      const number = parts[1] ?? '';

      const rect = seatElement.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();

      if (containerRect && tooltipRef.current) {
        const x = rect.left - containerRect.left + rect.width / 2;
        const y = rect.top - containerRect.top - 8;
        tooltipRef.current.textContent = `${tierInfo.tierName} ${row}${number ? `열 ${number}번` : ''}`;
        tooltipRef.current.style.left = `${x}px`;
        tooltipRef.current.style.top = `${y}px`;
        tooltipRef.current.style.display = 'block';

        if (state === 'available' && !selectedSeatIds.has(seatId)) {
          seatElement.style.filter = 'brightness(1.15)';
          seatElement.setAttribute('stroke', tierInfo.color);
          seatElement.setAttribute('stroke-width', '2');
        }
      }
    },
    [seatStates, selectedSeatIds, tierColorMap],
  );

  const handleMouseOut = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest<SVGElement>(
        `[data-seat-id],[${SEAT_OVERLAY_ATTR}]`,
      );
      if (!target) return;

      if (tooltipRef.current) tooltipRef.current.style.display = 'none';

      const seatId = target.getAttribute('data-seat-id')
        ?? target.getAttribute(SEAT_OVERLAY_ATTR);
      if (!seatId) return;

      const seatElement = target.hasAttribute('data-seat-id')
        ? target
        : findSeatElementById(containerRef.current, seatId);
      if (!seatElement) return;

      const isSelected = selectedSeatIds.has(seatId);
      if (isSelected) return;

      seatElement.style.filter = '';
      const state = seatStates.get(seatId) ?? 'available';
      if (state === 'available') {
        seatElement.removeAttribute('stroke');
        seatElement.setAttribute('stroke-width', '0');
      }
    },
    // review IN-02: tierColorMap 미사용이므로 deps에서 제거.
    //   seatConfig 변경 시 불필요한 함수 재생성 방지.
    [seatStates, selectedSeatIds],
  );

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg bg-gray-50 p-8 lg:min-h-[500px]">
        <p className="text-sm text-gray-600">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="mr-2 size-4" />
          새로고침
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="relative flex min-h-[300px] items-center justify-center rounded-lg bg-gray-50 lg:min-h-[500px]">
        <Skeleton className="absolute inset-0 rounded-lg" />
        <Loader2 className="relative z-10 size-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!processedSvg) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-lg bg-gray-50 lg:min-h-[500px]">
        <p className="text-sm text-gray-500">
          좌석 배치도가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-gray-50">
      <TransformWrapper
        key={isMobile ? 'mobile' : 'desktop'}
        initialScale={isMobile ? 1.4 : 1}
        minScale={0.5}
        maxScale={4}
        centerOnInit
        wheel={{ step: 0.1 }}
        doubleClick={{ disabled: true }}
      >
        <SeatMapControls />
        {!isMobile && (
          <MiniMap
            width={120}
            borderColor="#6C3CE0"
            className="absolute top-3 left-3 z-40 rounded-md border border-gray-200 bg-white/90 p-1 shadow-md"
          >
            <div
              dangerouslySetInnerHTML={{ __html: prefixSvgDefsIds(processedSvg, 'mini-') }}
              aria-label="좌석 미니맵"
            />
          </MiniMap>
        )}
        <TransformComponent
          wrapperClass="w-full min-h-[300px] lg:min-h-[500px]"
          contentClass="w-full"
          wrapperStyle={{ width: '100%', maxWidth: '100%' }}
          contentStyle={{ width: '100%' }}
        >
          <div
            ref={containerRef}
            role="grid"
            aria-label="좌석 배치도"
            onClick={handleClick}
            onMouseOver={handleMouseOver}
            onMouseOut={handleMouseOut}
            dangerouslySetInnerHTML={{ __html: processedSvg }}
          />
        </TransformComponent>
      </TransformWrapper>

      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-50 rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white"
        style={{ display: 'none', transform: 'translate(-50%, -100%)' }}
      />
    </div>
  );
}
