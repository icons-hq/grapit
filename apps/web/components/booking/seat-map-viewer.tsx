'use client';

import { memo, useRef, useState, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { TransformWrapper, TransformComponent, MiniMap } from 'react-zoom-pan-pinch';
import { Loader2, RefreshCw } from 'lucide-react';
import type { SeatMapConfig, SeatState } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SeatMapControls } from './seat-map-controls';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { prefixSvgDefsIds } from './__utils__/prefix-svg-defs-ids';
import { sanitizeParsedSvg } from '@/lib/svg/safety';
import { getSeatSelectionCopy } from '@/lib/booking/seat-selection-copy';
import { formatCopy } from '@/lib/i18n/client-copy';

type RuntimeSeatState = SeatState | 'disabled';
type SeatSelectionCopy = ReturnType<typeof getSeatSelectionCopy>;

interface SeatMapViewerProps {
  svgUrl: string;
  floorKey?: string;
  floorLabel?: string;
  seatConfig: SeatMapConfig;
  seatStates: ReadonlyMap<string, RuntimeSeatState>;
  selectedSeatIds: Set<string>;
  myLockedSeatIds?: Set<string>;
  onSeatClick: (runtimeSeatId: string) => void;
  maxSelect: number;
}

interface TierInfo {
  tierName: string;
  color: string;
}

interface SeatIdentity {
  runtimeSeatId: string;
  seatId: string;
}

interface ListSeat {
  id: string;
  localId: string;
  label: string;
}

/** SVG를 한 번 파싱·정리한 결과. 좌석 상태와 무관하므로 svgUrl·층·tier 설정이 바뀔 때만 다시 만든다. */
interface SeatMapBase {
  html: string;
  listSeats: ListSeat[];
}

/**
 * 마운트된 SVG 위에 좌석 상태를 제자리에서 칠할 때 쓰는 시각 상태.
 * - available: tier 색, 외곽선 없음
 * - unavailable: 다른 사용자 lock·판매·보류·비활성 (D-13: 즉시 회색, transition 없음)
 * - selected: 내가 선택한 좌석 (brand purple로 150ms transition + 체크마크)
 * - removing: 선택 해제 직후 150ms (tier 색으로 transition + 체크마크 fade-out)
 * - owned: my-locks로 복원 중인 내 lock 좌석 (tier 색 + 체크마크)
 */
type SeatVisual = 'available' | 'unavailable' | 'selected' | 'removing' | 'owned';

interface SeatEntry extends SeatIdentity {
  element: SVGElement;
  tierInfo: TierInfo;
  checkmarkPosition: { x: number; y: number } | null;
  checkmark: SVGTextElement | null;
  visual: SeatVisual;
}

/** 마운트된 SVG 루트의 좌석 element index. 루트가 바뀌면(층 변경·재마운트) 다시 만든다. */
interface SeatIndex {
  root: Element;
  html: string;
  entries: SeatEntry[];
  elementsByIdentity: Map<string, SVGElement>;
}

const LOCKED_COLOR = '#D1D5DB';
const SELECTED_STROKE = '#1A1A2E';
const SELECTED_FILL = '#6C3CE0'; // Brand Purple — D-03
const EXCLUDED_COLOR = '#F4D03F';
const SEAT_TRANSITION = 'fill 150ms ease-out, stroke 150ms ease-out';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SEAT_ID_ATTR = 'data-seat-id';
const SEAT_KEY_ATTR = 'data-seat-key';
const SEAT_OVERLAY_ATTR = 'data-seat-overlay-for';
const SEAT_SELECTOR = `[${SEAT_KEY_ATTR}],[${SEAT_ID_ATTR}]`;
const SEAT_TARGET_SELECTOR = `${SEAT_SELECTOR},[${SEAT_OVERLAY_ATTR}]`;
const EMPTY_SEAT_ID_SET = new Set<string>();
const VALID_STAGES = ['top', 'right', 'bottom', 'left'] as const;
type ValidStage = (typeof VALID_STAGES)[number];

function getLocalSeatId(runtimeSeatId: string) {
  const separatorIndex = runtimeSeatId.indexOf(':');
  return separatorIndex > 0 ? runtimeSeatId.slice(separatorIndex + 1) : runtimeSeatId;
}

function toRuntimeSeatId(seatId: string, floorKey?: string) {
  return floorKey ? `${floorKey}:${seatId}` : seatId;
}

function getSeatIdentity(element: Element | null, floorKey?: string): SeatIdentity | null {
  if (!element) {
    return null;
  }

  const seatKey = element.getAttribute(SEAT_KEY_ATTR);
  const seatId = element.getAttribute(SEAT_ID_ATTR) ?? (seatKey ? getLocalSeatId(seatKey) : null);

  if (!seatId) {
    return null;
  }

  const runtimeSeatId = floorKey
    ? toRuntimeSeatId(seatId, floorKey)
    : seatKey ?? seatId;

  return { runtimeSeatId, seatId };
}

function isUnavailableSeatState(state: RuntimeSeatState | undefined) {
  return state === 'locked' || state === 'sold' || state === 'held' || state === 'disabled';
}

function getSeatState(
  seatStates: ReadonlyMap<string, RuntimeSeatState>,
  runtimeSeatId: string,
  seatId: string,
) {
  return seatStates.get(runtimeSeatId) ?? seatStates.get(seatId) ?? 'available';
}

function hasSeat(ids: ReadonlySet<string>, identity: SeatIdentity) {
  return ids.has(identity.runtimeSeatId) || ids.has(identity.seatId);
}

function getTierInfo(tierColorMap: ReadonlyMap<string, TierInfo>, identity: SeatIdentity) {
  return tierColorMap.get(identity.seatId) ?? tierColorMap.get(identity.runtimeSeatId);
}

function isExcludedSeatElement(el: Element, tierInfoExists: boolean) {
  const className = el.getAttribute('class') ?? '';
  const category = (el.getAttribute('data-category') ?? '').toLowerCase();

  return (
    className.split(/\s+/).includes('seat-excluded') ||
    category === 'excluded' ||
    category === '사석' ||
    el.getAttribute('data-seat-excluded') === 'true' ||
    !tierInfoExists
  );
}

function resolveSeatVisual(
  identity: SeatIdentity,
  seatStates: ReadonlyMap<string, RuntimeSeatState>,
  selectedSeatIds: ReadonlySet<string>,
  myLockedSeatIds: ReadonlySet<string>,
  isRemoving: boolean,
): SeatVisual {
  const state = getSeatState(seatStates, identity.runtimeSeatId, identity.seatId);
  const isMyLocked = state === 'locked' && hasSeat(myLockedSeatIds, identity);
  // reviews revision MED #4 D-13 BROADCAST PRIORITY: unavailable 상태가 선택보다 우선한다.
  if (isUnavailableSeatState(state) && !isMyLocked) return 'unavailable';
  if (hasSeat(selectedSeatIds, identity)) return 'selected';
  if (isRemoving) return 'removing';
  if (isMyLocked) return 'owned';
  return 'available';
}

function paintExcludedSeat(el: Element) {
  el.setAttribute('data-seat-excluded', 'true');
  el.setAttribute('aria-disabled', 'true');
  el.setAttribute('fill', el.getAttribute('fill') || EXCLUDED_COLOR);
  el.removeAttribute('stroke');
  el.setAttribute('stroke-width', '0');
  el.setAttribute('style', 'cursor:not-allowed;opacity:0.85;transition:none');
}

/**
 * 좌석 하나의 속성을 시각 상태에 맞게 칠한다. style(transition)을 fill보다 먼저 바꿔
 * unavailable 전환은 즉시, 선택·해제 전환은 150ms transition으로 보이게 한다.
 */
function paintSeat(el: Element, visual: SeatVisual, tierInfo: TierInfo) {
  switch (visual) {
    case 'unavailable':
      el.setAttribute('style', 'cursor:not-allowed;opacity:0.6;transition:none');
      el.setAttribute('fill', LOCKED_COLOR);
      el.removeAttribute('stroke');
      el.setAttribute('stroke-width', '0');
      el.removeAttribute('data-tier-id');
      return;
    case 'selected':
      el.setAttribute('style', `cursor:pointer;opacity:1;transition:${SEAT_TRANSITION}`);
      el.setAttribute('fill', SELECTED_FILL);
      el.setAttribute('stroke', SELECTED_STROKE);
      el.setAttribute('stroke-width', '3');
      el.setAttribute('data-tier-id', tierInfo.tierName);
      return;
    case 'removing':
      el.setAttribute('style', `cursor:pointer;opacity:1;transition:${SEAT_TRANSITION}`);
      el.setAttribute('fill', tierInfo.color);
      el.setAttribute('stroke', SELECTED_STROKE);
      el.setAttribute('stroke-width', '3');
      el.setAttribute('data-tier-id', tierInfo.tierName);
      return;
    case 'owned':
      el.setAttribute('style', 'cursor:pointer;opacity:1;');
      el.setAttribute('fill', tierInfo.color);
      el.setAttribute('stroke', SELECTED_STROKE);
      el.setAttribute('stroke-width', '3');
      el.setAttribute('data-tier-id', tierInfo.tierName);
      return;
    case 'available':
      el.setAttribute('style', 'cursor:pointer;opacity:1;transition:none');
      el.setAttribute('fill', tierInfo.color);
      el.setAttribute('data-tier-id', tierInfo.tierName);
      el.removeAttribute('stroke');
      el.setAttribute('stroke-width', '0');
  }
}

function getCheckmarkPosition(el: Element) {
  const tagName = el.tagName.toLowerCase();
  if (tagName === 'rect') {
    const x = parseFloat(el.getAttribute('x') ?? '0');
    const y = parseFloat(el.getAttribute('y') ?? '0');
    const width = parseFloat(el.getAttribute('width') ?? '0');
    const height = parseFloat(el.getAttribute('height') ?? '0');
    return { x: x + width / 2, y: y + height / 2 };
  }
  if (tagName === 'circle') {
    return {
      x: parseFloat(el.getAttribute('cx') ?? '0'),
      y: parseFloat(el.getAttribute('cy') ?? '0'),
    };
  }
  return null;
}

/** 선택·내 lock·해제 중 좌석의 흰색 체크마크를 좌석 바로 뒤 형제로 유지한다(D-12 fade-in/out). */
function syncCheckmark(entry: SeatEntry, visual: SeatVisual) {
  const needsCheckmark = visual === 'selected' || visual === 'owned' || visual === 'removing';
  if (!needsCheckmark || !entry.checkmarkPosition) {
    entry.checkmark?.remove();
    entry.checkmark = null;
    return;
  }

  let checkmark = entry.checkmark;
  if (!checkmark || !checkmark.isConnected) {
    checkmark = entry.element.ownerDocument.createElementNS(SVG_NS, 'text');
    checkmark.setAttribute('x', String(entry.checkmarkPosition.x));
    checkmark.setAttribute('y', String(entry.checkmarkPosition.y));
    checkmark.setAttribute('text-anchor', 'middle');
    checkmark.setAttribute('dominant-baseline', 'central');
    checkmark.setAttribute('fill', 'white');
    checkmark.setAttribute('font-size', '12');
    checkmark.setAttribute('font-weight', 'bold');
    checkmark.setAttribute('pointer-events', 'none');
    // D-12 mount fade-in — CSS @keyframes (globals.css Plan 12-01)
    checkmark.setAttribute('data-seat-checkmark', '');
    checkmark.textContent = '✓';
    entry.element.parentNode?.insertBefore(checkmark, entry.element.nextSibling);
    entry.checkmark = checkmark;
  }

  // 해제 중: data-fading-out="true" → 150ms fade-out 뒤 pendingRemovals 정리로 제거된다.
  if (visual === 'removing') {
    checkmark.setAttribute('data-fading-out', 'true');
  } else {
    checkmark.removeAttribute('data-fading-out');
  }
}

function normalizeSeatLabelOverlays(doc: Document, floorKey?: string) {
  const seatParents = new Set<Element>();
  doc.querySelectorAll(SEAT_SELECTOR).forEach((seatEl) => {
    if (seatEl.parentElement) {
      seatParents.add(seatEl.parentElement);
    }
  });

  seatParents.forEach((parent) => {
    if (parent.tagName.toLowerCase() === 'svg') {
      return;
    }

    const seatChildren = Array.from(parent.children).filter((child) =>
      child.hasAttribute(SEAT_KEY_ATTR) || child.hasAttribute(SEAT_ID_ATTR)
    );
    if (seatChildren.length !== 1) {
      return;
    }

    const identity = getSeatIdentity(seatChildren[0] ?? null, floorKey);
    if (!identity) {
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

        overlayText.setAttribute(SEAT_OVERLAY_ATTR, identity.runtimeSeatId);
        overlayText.setAttribute('pointer-events', 'none');
      });
    });
  });
}

/**
 * Labels drawn on top of seats (row letters, seat numbers in their own <g>, the
 * stage badge) must not take the click or tap: a label over a seat would make
 * closest(SEAT_TARGET_SELECTOR) miss and the seat would not toggle. Every text
 * that is not itself a seat (or inside one) lets the pointer through to the
 * seat underneath. Applied to the in-memory document only; the stored SVG is
 * unchanged.
 */
function passPointerThroughNonSeatText(doc: Document) {
  doc.querySelectorAll('text, tspan').forEach((textEl) => {
    if (textEl.closest(SEAT_SELECTOR)) {
      return;
    }
    textEl.setAttribute('pointer-events', 'none');
  });
}

function appendStageBadge(doc: Document, svgEl: Element, seatCopy: SeatSelectionCopy) {
  // reviews revision HIGH #2 + W-1: unified parsing contract — descendant [data-stage] + VALID_STAGES enum
  // ⚠ in-memory `doc`에만 적용 — R2 원본 SVG 파일은 변경하지 않음 (D-19 호환)
  const hasStageText = Array.from(doc.querySelectorAll('text')).some(
    (t) => t.textContent?.trim() === 'STAGE',
  );
  const stageEl = doc.querySelector('[data-stage]');
  const rawStageValue = stageEl?.getAttribute('data-stage') ?? null;
  // enum 검증 + default top fallback (admin에서 이미 걸러지지만 viewer 방어적 코드)
  const dataStage: ValidStage | null =
    rawStageValue && (VALID_STAGES as readonly string[]).includes(rawStageValue)
      ? (rawStageValue as ValidStage)
      : rawStageValue !== null
        ? 'top'
        : null;

  if (hasStageText || !dataStage) {
    return;
  }

  // reviews revision LOW #8: viewBox가 whitespace OR comma separated, [minX, minY, width, height] 모두 사용
  const viewBoxAttr = svgEl.getAttribute('viewBox') ?? '0 0 800 600';
  const viewBoxValues = viewBoxAttr.split(/[\s,]+/).map(Number);
  const vbMinX = viewBoxValues[0] ?? 0;
  const vbMinY = viewBoxValues[1] ?? 0;
  const vbW = viewBoxValues[2] ?? 800;
  const vbH = viewBoxValues[3] ?? 600;
  const overlayG = doc.createElementNS(SVG_NS, 'g');
  overlayG.setAttribute('aria-label', formatCopy(seatCopy.stage, { position: dataStage }));
  const badgeRect = doc.createElementNS(SVG_NS, 'rect');
  const badgeText = doc.createElementNS(SVG_NS, 'text');
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

/**
 * (#11) 좌석맵 SVG를 파싱·sanitize·정적 정규화해 한 번만 직렬화한다.
 * 좌석 상태(seat-update)는 여기 반영하지 않는다 — 마운트 뒤 바뀐 좌석의 속성만 제자리에서 갱신한다.
 */
function buildSeatMapBase(
  rawSvg: string,
  floorKey: string | undefined,
  floorLabel: string | undefined,
  tierColorMap: ReadonlyMap<string, TierInfo>,
  seatCopy: SeatSelectionCopy,
): SeatMapBase | null {
  const doc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml');
  // review WR-03: admin/prefix-svg-defs-ids와 통일된 parsererror 가드.
  //   R2가 손상된 SVG 또는 CDN 에러 페이지(HTML)를 반환한 엣지 케이스에서
  //   viewer가 parsererror 문서를 그대로 rendering하지 않도록 fallback 분기로 유도.
  if (
    doc.documentElement.tagName === 'parsererror' ||
    doc.querySelector('parsererror')
  ) {
    return null;
  }
  // (#49) 루트가 SVG가 아니면 렌더링하지 않는다. 주석·PI·비허용 요소/속성은 여기서 제거된다.
  if (!sanitizeParsedSvg(doc)) {
    return null;
  }

  const listSeats = new Map<string, ListSeat>();
  doc.querySelectorAll(SEAT_SELECTOR).forEach((el) => {
    const identity = getSeatIdentity(el, floorKey);
    if (!identity) return;
    if (floorKey) {
      el.setAttribute(SEAT_KEY_ATTR, identity.runtimeSeatId);
    }

    const tierInfo = getTierInfo(tierColorMap, identity);
    if (!tierInfo || isExcludedSeatElement(el, true)) {
      paintExcludedSeat(el);
      return;
    }

    const [row, number = ''] = identity.seatId.split('-');
    listSeats.set(identity.runtimeSeatId, {
      id: identity.runtimeSeatId,
      localId: identity.seatId,
      label: `${tierInfo.tierName} ${formatCopy(seatCopy.seatLabel, { floor: floorLabel ?? '', row, number })}`,
    });
    // 기본 tier 색. 실제 좌석 상태는 마운트 직후(paint 전) layout effect가 덧칠한다.
    paintSeat(el, 'available', tierInfo);
  });

  // Ensure viewBox exists (required — without it SVG disappears when width/height are removed)
  const svgEl = doc.documentElement;
  if (!svgEl.getAttribute('viewBox')) {
    const w = svgEl.getAttribute('width') || '800';
    const h = svgEl.getAttribute('height') || '600';
    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  if (floorLabel) {
    svgEl.setAttribute('aria-label', `${floorLabel} ${seatCopy.map}`);
    const directTitle = Array.from(svgEl.children).find(
      (child) => child.tagName.toLowerCase() === 'title',
    );
    if (directTitle) {
      directTitle.textContent = `${floorLabel} ${seatCopy.map}`;
    }
  }

  appendStageBadge(doc, svgEl, seatCopy);
  normalizeSeatLabelOverlays(doc, floorKey);
  passPointerThroughNonSeatText(doc);

  // Remove fixed dimensions and make responsive
  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
  svgEl.setAttribute('style', 'width:100%;height:auto;display:block;');

  return { html: svgEl.outerHTML, listSeats: [...listSeats.values()] };
}

function buildSeatIndex(
  root: Element,
  html: string,
  floorKey: string | undefined,
  tierColorMap: ReadonlyMap<string, TierInfo>,
): SeatIndex {
  const entries: SeatEntry[] = [];
  const elementsByIdentity = new Map<string, SVGElement>();

  root.querySelectorAll<SVGElement>(SEAT_SELECTOR).forEach((element) => {
    const identity = getSeatIdentity(element, floorKey);
    if (!identity) return;
    // 기존 선형 탐색(findSeatElementByIdentity)과 같이 문서 순서상 첫 좌석을 우선한다.
    if (!elementsByIdentity.has(identity.runtimeSeatId)) {
      elementsByIdentity.set(identity.runtimeSeatId, element);
    }
    if (!elementsByIdentity.has(identity.seatId)) {
      elementsByIdentity.set(identity.seatId, element);
    }

    const tierInfo = getTierInfo(tierColorMap, identity);
    if (!tierInfo || element.getAttribute('data-seat-excluded') === 'true') {
      return;
    }

    entries.push({
      ...identity,
      element,
      tierInfo,
      checkmarkPosition: getCheckmarkPosition(element),
      checkmark: null,
      visual: 'available',
    });
  });

  return { root, html, entries, elementsByIdentity };
}

function buildTierColorMap(tiers: SeatMapConfig['tiers']) {
  const map = new Map<string, TierInfo>();
  for (const tier of tiers) {
    for (const seatId of tier.seatIds) {
      map.set(seatId, { tierName: tier.tierName, color: tier.color });
    }
  }
  return map;
}

function SeatMapViewerComponent({
  svgUrl,
  floorKey,
  floorLabel,
  seatConfig,
  seatStates,
  selectedSeatIds,
  myLockedSeatIds = EMPTY_SEAT_ID_SET,
  onSeatClick,
  maxSelect,
}: SeatMapViewerProps) {
  const seatCopy = getSeatSelectionCopy();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const seatIndexRef = useRef<SeatIndex | null>(null);
  // 응답을 요청한 svgUrl과 함께 보관해, 층을 빠르게 바꿀 때 이전 층 SVG가 새 층 키로 칠해지지 않게 한다.
  const [svgSource, setSvgSource] = useState<{ url: string; text: string } | null>(null);
  const [failedSvgUrl, setFailedSvgUrl] = useState<string | null>(null);
  const [listSeatId, setListSeatId] = useState('');
  const [isListOpen, setIsListOpen] = useState(false);

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

  // seatConfig 객체 참조가 매 렌더 새로 만들어져도 내용이 같으면 SVG를 다시 파싱하지 않는다.
  const tierSignature = useMemo(() => JSON.stringify(seatConfig.tiers), [seatConfig]);
  const tierColorMap = useMemo(
    () => buildTierColorMap(JSON.parse(tierSignature) as SeatMapConfig['tiers']),
    [tierSignature],
  );

  // Fetch raw SVG
  useEffect(() => {
    if (!svgUrl) return;
    let cancelled = false;

    fetch(svgUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch SVG');
        return res.text();
      })
      .then((text) => {
        // 층을 빠르게 바꾸면 이전 층 응답이 늦게 도착할 수 있다 — 현재 svgUrl 응답만 반영한다.
        if (cancelled) return;
        setSvgSource({ url: svgUrl, text });
        setFailedSvgUrl((failed) => (failed === svgUrl ? null : failed));
      })
      .catch(() => {
        if (cancelled) return;
        setFailedSvgUrl(svgUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [svgUrl]);

  const rawSvg = svgSource?.url === svgUrl ? svgSource.text : null;
  const error = failedSvgUrl === svgUrl && rawSvg === null ? 'load_failed' : null;
  const isLoading = rawSvg === null && !error;

  // (#11) 파싱·sanitize·직렬화는 SVG·층·tier 설정이 바뀔 때만 한다. seat-update는 여기를 다시 타지 않는다.
  const seatMapBase = useMemo(
    () => (rawSvg ? buildSeatMapBase(rawSvg, floorKey, floorLabel, tierColorMap, seatCopy) : null),
    [rawSvg, floorKey, floorLabel, tierColorMap, seatCopy],
  );

  // React는 dangerouslySetInnerHTML 객체 참조가 바뀌면 innerHTML을 다시 쓴다. 객체를 고정해
  // 렌더마다 좌석 DOM이 교체되어 탭 대상이 분리되는 일을 막는다.
  const seatMapMarkup = useMemo(
    () => (seatMapBase ? { __html: seatMapBase.html } : null),
    [seatMapBase],
  );
  // MiniMap은 상태를 반영하지 않는 정적 tier 색 SVG로 한 번만 만든다(모바일에서는 렌더하지 않음).
  const miniMapMarkup = useMemo(
    () => (seatMapBase && !isMobile ? { __html: prefixSvgDefsIds(seatMapBase.html, 'mini-') } : null),
    [seatMapBase, isMobile],
  );

  const resolveSeatIndex = useCallback((): SeatIndex | null => {
    const root = containerRef.current?.firstElementChild ?? null;
    if (!root || !seatMapBase) {
      seatIndexRef.current = null;
      return null;
    }

    const current = seatIndexRef.current;
    if (current && current.root === root && current.html === seatMapBase.html) {
      return current;
    }

    const next = buildSeatIndex(root, seatMapBase.html, floorKey, tierColorMap);
    seatIndexRef.current = next;
    return next;
  }, [seatMapBase, floorKey, tierColorMap]);

  const findSeatElement = useCallback(
    (runtimeSeatId: string) => resolveSeatIndex()?.elementsByIdentity.get(runtimeSeatId) ?? null,
    [resolveSeatIndex],
  );

  // (#11) 좌석 상태 반영: 이전에 칠한 시각 상태와 비교해 바뀐 좌석의 속성만 제자리에서 갱신한다.
  //   - innerHTML을 교체하지 않으므로 탭 도중 좌석 element가 분리되지 않는다.
  //   - 같은 element의 속성을 바꾸므로 선택·해제 CSS transition이 실제로 발화한다
  //     (B-2-RESIDUAL-V2 Option C / RESEARCH §Pitfall 3).
  //   - layout effect라 첫 paint 전에 실제 상태가 칠해진다.
  //   - 매 commit마다 실행해 TransformWrapper 재마운트·로딩 후 재마운트로 SVG 루트가 바뀐 경우도
  //     index를 다시 만든다. 바뀌지 않은 좌석은 비교만 하고 DOM을 건드리지 않는다.
  useLayoutEffect(() => {
    const index = resolveSeatIndex();
    if (!index) return;

    // 아직 pendingRemovals에 들어가기 전(선택 해제 직후 첫 commit)에도 해제 transition을 보여준다.
    const previouslySelected = prevSelectedRef.current;
    for (const entry of index.entries) {
      const visual = resolveSeatVisual(
        entry,
        seatStates,
        selectedSeatIds,
        myLockedSeatIds,
        hasSeat(pendingRemovals, entry) || hasSeat(previouslySelected, entry),
      );
      if (visual === entry.visual) continue;
      paintSeat(entry.element, visual, entry.tierInfo);
      syncCheckmark(entry, visual);
      entry.visual = visual;
    }
  });

  // 목록 선택은 펼쳤을 때만 계산·렌더한다. 접힌 상태에서 seat-update마다 수천 개 <option>을
  // 다시 그리지 않는다.
  const listOptions = useMemo(() => {
    if (!isListOpen || !seatMapBase) return [];
    return seatMapBase.listSeats.map((seat) => {
      const identity = { runtimeSeatId: seat.id, seatId: seat.localId };
      const selected = hasSeat(selectedSeatIds, identity);
      const ownedLock = hasSeat(myLockedSeatIds, identity);
      const state = getSeatState(seatStates, seat.id, seat.localId);
      return { ...seat, selected: selected || ownedLock,
        disabled: !selected && !ownedLock && (isUnavailableSeatState(state) || selectedSeatIds.size >= maxSelect) };
    });
  }, [isListOpen, seatMapBase, selectedSeatIds, myLockedSeatIds, seatStates, maxSelect]);
  const listSelection = listOptions.find((seat) => seat.id === listSeatId);

  // Event delegation for seat clicks
  // review WR-02 + IN-01: maxSelect prop을 viewer 내부에서 방어적으로 사용.
  //   상위(booking-page)가 MAX_SEATS를 주요 검증하지만, viewer에서도 double-defense로
  //   "선택되지 않은 좌석"을 새로 누를 때만 한도 검사를 건다. 선택된 좌석 해제는 항상 허용.
  //   deps에 selectedSeatIds.size와 selectedSeatIds.has가 실제 사용되므로 유지.
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest<SVGElement>(SEAT_TARGET_SELECTOR);
      if (!target) return;

      const overlayIdentity = target.getAttribute(SEAT_OVERLAY_ATTR);
      const identity = overlayIdentity
        ? { runtimeSeatId: overlayIdentity, seatId: getLocalSeatId(overlayIdentity) }
        : getSeatIdentity(target, floorKey);
      if (!identity) return;

      const seatElement = target.hasAttribute(SEAT_KEY_ATTR) || target.hasAttribute(SEAT_ID_ATTR)
        ? target
        : findSeatElement(identity.runtimeSeatId);
      if (!seatElement || seatElement.getAttribute('data-seat-excluded') === 'true') {
        return;
      }

      const state = getSeatState(seatStates, identity.runtimeSeatId, identity.seatId);
      const isSelected = hasSeat(selectedSeatIds, identity);
      const isMyLocked = state === 'locked' && hasSeat(myLockedSeatIds, identity);
      if (isUnavailableSeatState(state) && !isSelected && !isMyLocked) return;
      if (!isSelected && !isMyLocked && selectedSeatIds.size >= maxSelect) {
        return;
      }
      onSeatClick(identity.runtimeSeatId);
    },
    [seatStates, selectedSeatIds, myLockedSeatIds, onSeatClick, maxSelect, floorKey, findSeatElement],
  );

  // Hover tooltip — uses refs only, no state changes, no re-renders
  const handleMouseOver = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest<SVGElement>(SEAT_TARGET_SELECTOR);
      if (!target) {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        return;
      }

      const overlayIdentity = target.getAttribute(SEAT_OVERLAY_ATTR);
      const identity = overlayIdentity
        ? { runtimeSeatId: overlayIdentity, seatId: getLocalSeatId(overlayIdentity) }
        : getSeatIdentity(target, floorKey);
      if (!identity) return;

      const seatElement = target.hasAttribute(SEAT_KEY_ATTR) || target.hasAttribute(SEAT_ID_ATTR)
        ? target
        : findSeatElement(identity.runtimeSeatId);
      if (!seatElement) return;
      if (seatElement.getAttribute('data-seat-excluded') === 'true') {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        return;
      }

      const state = getSeatState(seatStates, identity.runtimeSeatId, identity.seatId);
      const isSelected = hasSeat(selectedSeatIds, identity);
      if (state !== 'available' && !isSelected) {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        return;
      }

      const tierInfo = getTierInfo(tierColorMap, identity);
      if (!tierInfo) return;

      const parts = identity.seatId.split('-');
      const row = parts[0] ?? identity.seatId;
      const number = parts[1] ?? '';

      const rect = seatElement.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();

      if (containerRect && tooltipRef.current) {
        const x = rect.left - containerRect.left + rect.width / 2;
        const y = rect.top - containerRect.top - 8;
        tooltipRef.current.textContent = `${tierInfo.tierName} ${formatCopy(seatCopy.seatLabel, { floor: floorLabel ?? '', row, number })}`;
        tooltipRef.current.style.left = `${x}px`;
        tooltipRef.current.style.top = `${y}px`;
        tooltipRef.current.style.display = 'block';

        if (state === 'available' && !isSelected) {
          seatElement.style.filter = 'brightness(1.15)';
          seatElement.setAttribute('stroke', tierInfo.color);
          seatElement.setAttribute('stroke-width', '2');
        }
      }
    },
    [seatStates, selectedSeatIds, tierColorMap, floorKey, floorLabel, seatCopy, findSeatElement],
  );

  const handleMouseOut = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest<SVGElement>(SEAT_TARGET_SELECTOR);
      if (!target) return;

      if (tooltipRef.current) tooltipRef.current.style.display = 'none';

      const overlayIdentity = target.getAttribute(SEAT_OVERLAY_ATTR);
      const identity = overlayIdentity
        ? { runtimeSeatId: overlayIdentity, seatId: getLocalSeatId(overlayIdentity) }
        : getSeatIdentity(target, floorKey);
      if (!identity) return;

      const seatElement = target.hasAttribute(SEAT_KEY_ATTR) || target.hasAttribute(SEAT_ID_ATTR)
        ? target
        : findSeatElement(identity.runtimeSeatId);
      if (!seatElement) return;

      const isSelected = hasSeat(selectedSeatIds, identity);
      if (isSelected) return;

      seatElement.style.filter = '';
      const state = getSeatState(seatStates, identity.runtimeSeatId, identity.seatId);
      if (state === 'available') {
        seatElement.removeAttribute('stroke');
        seatElement.setAttribute('stroke-width', '0');
      }
    },
    // review IN-02: tierColorMap 미사용이므로 deps에서 제거.
    //   seatConfig 변경 시 불필요한 함수 재생성 방지.
    [seatStates, selectedSeatIds, floorKey, findSeatElement],
  );

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg bg-gray-50 p-8 lg:min-h-[500px]">
        <p className="text-sm text-gray-600">{seatCopy.mapError}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="mr-2 size-4" />
          {seatCopy.refresh}
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

  if (!seatMapMarkup) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-lg bg-gray-50 lg:min-h-[500px]">
        <p className="text-sm text-gray-500">
          {seatCopy.mapPending}
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-gray-50">
      <details
        className="border-b border-gray-200 bg-white p-4"
        onToggle={(event) => setIsListOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-primary">
          {seatCopy.listSummary}
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <select aria-label={seatCopy.listLabel} value={listSelection ? listSeatId : ''}
            onChange={(event) => setListSeatId(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm">
            <option value="">{seatCopy.chooseSeat}</option>
            {listOptions.map((seat) => <option key={seat.id} value={seat.id} disabled={seat.disabled}>
              {seat.label}{seat.selected ? ` · ${seatCopy.selectedSeats}` : seat.disabled ? ` · ${seatCopy.unavailable}` : ''}
            </option>)}
          </select>
          <Button disabled={!listSelection || listSelection.disabled} onClick={() => {
            if (listSelection && !listSelection.disabled) onSeatClick(listSelection.id);
          }}>{listSelection?.selected ? seatCopy.deselectSeat : seatCopy.selectSeat}</Button>
        </div>
      </details>
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
        {!isMobile && miniMapMarkup && (
          <MiniMap
            width={120}
            borderColor="#6C3CE0"
            className="absolute top-3 left-3 z-40 rounded-md border border-gray-200 bg-white/90 p-1 shadow-md"
          >
            <div
              dangerouslySetInnerHTML={miniMapMarkup}
              aria-label={seatCopy.miniMap}
            />
          </MiniMap>
        )}
        <TransformComponent
          wrapperClass="flex w-full min-h-[300px] items-center justify-center lg:min-h-[500px]"
          contentClass="flex min-h-[300px] w-full items-center justify-center lg:min-h-[500px]"
          wrapperStyle={{ width: '100%', maxWidth: '100%' }}
          contentStyle={{ width: '100%' }}
        >
          <div
            ref={containerRef}
            data-testid="seat-map-canvas"
            className="mx-auto w-full max-w-full"
            role="img"
            aria-label={floorLabel ? `${floorLabel} ${seatCopy.map}` : seatCopy.map}
            onClick={handleClick}
            onMouseOver={handleMouseOver}
            onMouseOut={handleMouseOut}
            dangerouslySetInnerHTML={seatMapMarkup}
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

/**
 * Memoized: the booking page keeps every prop reference stable while only
 * other floors (or nothing on this floor) change, so a seat-update elsewhere
 * does not re-run the per-seat comparison of the whole map (audit #11).
 */
export const SeatMapViewer = memo(SeatMapViewerComponent);
