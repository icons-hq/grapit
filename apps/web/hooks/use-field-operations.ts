'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  benefitRedemptionResponseSchema,
  fieldBenefitEntitlementSchema,
  normalizeFieldCheckInOutcome,
  type BenefitRedemptionOutcome,
  type BenefitRedemptionRequest,
  type BenefitRedemptionResponse,
  type FieldBenefitEntitlement,
  type FieldCheckInConsumeRequest,
  type FieldCheckInConsumeResponse,
  type FieldCheckInVerifyRequest,
  type FieldCheckInVerifyResponse,
  type FieldOfflineSyncRequest,
  type FieldOfflineSyncResponse,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';

export type ScannerCheckInResult =
  | 'processable'
  | 'processed'
  | 'duplicate'
  | 'tampered'
  | 'refunded'
  | 'expired'
  | 'wrong-showtime'
  | 'offline-pending'
  | 'synced'
  | 'rejected';

export interface ScannerOfflineQueueItem {
  deviceAttemptId: string;
  state: 'pending' | 'synced' | 'rejected';
  attemptedAt: string;
  reason?: string | null;
}

export interface ScannerOfflineSyncResult {
  deviceAttemptId: string;
  state: 'synced' | 'rejected';
  result: ScannerCheckInResult;
  resultLabel: string;
  resolvedAt?: string;
  reason?: string | null;
  scanEventId?: string | null;
}

export interface ScannerPriorScanContext {
  checkedInAt?: string;
  scannedAt?: string;
  scannerName?: string;
  scannerUserId?: string;
  deviceAttemptId?: string;
}

export interface ScannerCheckInVerification {
  result: ScannerCheckInResult;
  resultLabel: string;
  processable: boolean;
  reservationNumber?: string;
  performanceTitle?: string;
  venueName?: string;
  showtimeAt?: string;
  showtimeId?: string;
  seats: readonly string[];
  ticketStatus?: string;
  rejectionReason?: string | null;
  priorScanContext?: ScannerPriorScanContext | null;
  offlineQueue: readonly ScannerOfflineQueueItem[];
  benefitEntitlements: readonly FieldBenefitEntitlement[];
  verifiedAt?: string;
}

export interface ScannerCheckInConsumeResult {
  result: ScannerCheckInResult;
  resultLabel: string;
  consumedAt?: string | null;
  rejectionReason?: string | null;
  priorScanContext?: ScannerPriorScanContext | null;
}

export interface ScannerBenefitRedemptionResult {
  outcome: BenefitRedemptionOutcome;
  outcomeLabel: string;
  redeemedAt?: string | null;
  rejectionReason?: string | null;
  priorRedemption?: {
    redeemedAt: string;
    scannerUserId?: string;
    deviceAttemptId?: string;
    redemptionEventId?: string;
  } | null;
}

interface UseFieldCheckInVerifyInput extends FieldCheckInVerifyRequest {
  enabled?: boolean;
}

export function useFieldCheckInVerify({
  enabled = true,
  ...input
}: UseFieldCheckInVerifyInput) {
  const tokenRef = input.token ?? input.qrUrl ?? '';

  return useQuery({
    queryKey: ['field', 'check-in', 'verify', tokenRef, input.showtimeId ?? ''],
    queryFn: async () => {
      const response = await apiClient.post<FieldCheckInVerifyResponse>(
        '/api/v1/field/check-in/verify',
        input,
        { showErrorToast: false },
      );
      return normalizeVerifyResponse(response);
    },
    enabled: enabled && tokenRef.length > 0,
    retry: false,
  });
}

export function useFieldCheckInConsume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: FieldCheckInConsumeRequest) => {
      const response = await apiClient.post<FieldCheckInConsumeResponse>(
        '/api/v1/field/check-in/consume',
        input,
        { showErrorToast: false },
      );
      return normalizeConsumeResponse(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field', 'check-in'] });
    },
  });
}

export function useFieldBenefitRedeem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BenefitRedemptionRequest) => {
      const response = await apiClient.post<BenefitRedemptionResponse>(
        '/api/v1/field/benefits/redeem',
        input,
        { showErrorToast: false },
      );
      return normalizeBenefitRedemptionResponse(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field', 'check-in'] });
    },
  });
}

export function useFieldOfflineSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: FieldOfflineSyncRequest) => {
      const response = await apiClient.post<FieldOfflineSyncResponse>(
        '/api/v1/field/check-in/offline-sync',
        input,
        { showErrorToast: false },
      );
      return normalizeOfflineSyncResponse(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field', 'check-in'] });
    },
  });
}

export function normalizeVerifyResponse(
  response: FieldCheckInVerifyResponse | Record<string, unknown>,
): ScannerCheckInVerification {
  const record = asRecord(response) ?? {};
  const ticket = asRecord(record['ticket']);
  const rawResult = stringValue(record['outcome']) ?? stringValue(record['result']);
  const result = normalizeResult(rawResult, booleanValue(record['processable']));
  const processable = booleanValue(record['processable']) ?? result === 'processable';

  return {
    result,
    resultLabel: stringValue(record['resultLabel']) ?? labelForResult(result),
    processable,
    reservationNumber:
      stringValue(record['reservationNumber']) ??
      stringValue(ticket?.['reservationNumber']),
    performanceTitle:
      stringValue(record['performanceTitle']) ??
      stringValue(ticket?.['performanceTitle']),
    venueName: stringValue(record['venueName']),
    showtimeAt:
      stringValue(record['showtimeAt']) ?? stringValue(ticket?.['showtimeLabel']),
    showtimeId: stringValue(record['showtimeId']) ?? stringValue(ticket?.['showtimeId']),
    seats: stringArray(record['seats']) ?? stringArray(ticket?.['seatLabels']) ?? [],
    ticketStatus:
      stringValue(record['ticketStatus']) ?? stringValue(ticket?.['ticketStatus']),
    rejectionReason: stringValue(record['rejectionReason']),
    priorScanContext: normalizePriorScan(
      record['priorScanContext'] ?? record['priorScan'],
    ),
    offlineQueue: normalizeOfflineQueue(record['offlineQueue']),
    benefitEntitlements: normalizeFieldBenefitEntitlements(
      record['benefitEntitlements'] ?? ticket?.['benefitEntitlements'],
    ),
    verifiedAt: stringValue(record['verifiedAt']),
  };
}

export function normalizeConsumeResponse(
  response: FieldCheckInConsumeResponse | Record<string, unknown>,
): ScannerCheckInConsumeResult {
  const record = asRecord(response) ?? {};
  const rawResult = stringValue(record['outcome']) ?? stringValue(record['result']);
  const result = normalizeResult(rawResult, false);

  return {
    result,
    resultLabel: stringValue(record['resultLabel']) ?? labelForResult(result),
    consumedAt: stringValue(record['consumedAt']),
    rejectionReason: stringValue(record['rejectionReason']),
    priorScanContext: normalizePriorScan(
      record['priorScanContext'] ?? record['priorScan'],
    ),
  };
}

export function normalizeBenefitRedemptionResponse(
  response: BenefitRedemptionResponse | Record<string, unknown>,
): ScannerBenefitRedemptionResult {
  const parsed = benefitRedemptionResponseSchema.safeParse(response);
  const record = (
    parsed.success ? parsed.data : (asRecord(response) ?? {})
  ) as Record<string, unknown>;
  const rawOutcome = stringValue(record['outcome']);
  const outcome = normalizeBenefitRedemptionOutcome(rawOutcome);
  const priorRedemption = normalizeBenefitPriorRedemption(record['priorRedemption']);

  return {
    outcome,
    outcomeLabel: labelForBenefitRedemptionOutcome(outcome),
    redeemedAt:
      stringValue(record['redeemedAt']) ?? priorRedemption?.redeemedAt ?? null,
    rejectionReason: stringValue(record['rejectionReason']),
    priorRedemption,
  };
}

export function normalizeOfflineSyncResponse(
  response: FieldOfflineSyncResponse | Record<string, unknown>,
): ScannerOfflineSyncResult[] {
  const record = asRecord(response) ?? {};
  const results = Array.isArray(record['results']) ? record['results'] : [];

  return results
    .map((item): ScannerOfflineSyncResult | null => {
      const row = asRecord(item);
      const deviceAttemptId = stringValue(row?.['deviceAttemptId']);
      const rawState = stringValue(row?.['syncState']) ?? stringValue(row?.['state']);
      if (!deviceAttemptId || (rawState !== 'synced' && rawState !== 'rejected')) {
        return null;
      }

      const result = normalizeResult(
        stringValue(row?.['outcome']) ?? stringValue(row?.['result']),
        false,
      );
      const reason =
        stringValue(row?.['reason']) ??
        stringValue(row?.['rejectionReason']) ??
        stringValue(row?.['resultLabel']);

      return {
        deviceAttemptId,
        state: rawState,
        result,
        resultLabel: stringValue(row?.['resultLabel']) ?? labelForResult(result),
        resolvedAt: stringValue(row?.['resolvedAt']),
        scanEventId: stringValue(row?.['scanEventId']),
        reason,
      };
    })
    .filter((item): item is ScannerOfflineSyncResult => item !== null);
}

export function labelForBenefitRedemptionOutcome(
  outcome: BenefitRedemptionOutcome,
): string {
  switch (outcome) {
    case 'redeemed':
      return '혜택 사용 처리 완료';
    case 'duplicate':
      return '이미 사용된 혜택입니다';
    case 'inactive':
      return '사용할 수 없는 혜택입니다';
    case 'wrong_showtime':
      return '현재 회차 혜택이 아닙니다';
    case 'not_eligible':
      return '이 티켓에 부여된 혜택이 아닙니다';
    case 'tampered':
      return 'QR 티켓을 확인할 수 없습니다';
  }
}

export function labelForResult(result: ScannerCheckInResult): string {
  switch (result) {
    case 'processable':
      return '입장 가능 티켓입니다';
    case 'processed':
    case 'synced':
      return '입장 처리가 완료되었습니다';
    case 'duplicate':
      return '이미 입장 처리된 티켓입니다';
    case 'tampered':
      return '확인할 수 없는 QR입니다';
    case 'refunded':
      return '환불 또는 취소된 티켓입니다';
    case 'wrong-showtime':
      return '현재 회차의 티켓이 아닙니다';
    case 'offline-pending':
      return '네트워크 문제로 보류 스캔에 저장했습니다. 연결이 복구되면 서버와 동기화하세요.';
    case 'expired':
    case 'rejected':
      return '확인할 수 없는 QR입니다';
  }
}

function normalizeFieldBenefitEntitlements(value: unknown): FieldBenefitEntitlement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): FieldBenefitEntitlement | null => {
      const parsed = fieldBenefitEntitlementSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is FieldBenefitEntitlement => item !== null);
}

function normalizeBenefitRedemptionOutcome(
  value: string | null | undefined,
): BenefitRedemptionOutcome {
  switch (value) {
    case 'redeemed':
    case 'duplicate':
    case 'inactive':
    case 'tampered':
    case 'wrong_showtime':
    case 'not_eligible':
      return value;
    default:
      return 'tampered';
  }
}

function normalizeBenefitPriorRedemption(
  value: unknown,
): ScannerBenefitRedemptionResult['priorRedemption'] {
  const record = asRecord(value);
  const redeemedAt = stringValue(record?.['redeemedAt']);
  if (!record || !redeemedAt) {
    return null;
  }

  return {
    redeemedAt,
    scannerUserId: stringValue(record['scannerUserId']),
    deviceAttemptId: stringValue(record['deviceAttemptId']),
    redemptionEventId: stringValue(record['redemptionEventId']),
  };
}

function normalizeResult(
  value: string | null | undefined,
  processable?: boolean | null,
): ScannerCheckInResult {
  if (processable) {
    return 'processable';
  }

  const outcome = normalizeFieldCheckInOutcome(value);

  switch (outcome) {
    case 'processable':
      return 'processable';
    case 'entered':
      return 'processed';
    case 'duplicate':
    case 'already_used':
      return 'duplicate';
    case 'refunded_cancelled':
      return 'refunded';
    case 'wrong_showtime':
      return 'wrong-showtime';
    case 'offline_pending':
      return 'offline-pending';
    case 'synced':
      return 'synced';
    case 'expired':
      return 'expired';
    case 'rejected':
      return 'rejected';
    case 'tampered':
    default:
      return 'tampered';
  }
}

function normalizePriorScan(value: unknown): ScannerPriorScanContext | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    checkedInAt: stringValue(record['checkedInAt']),
    scannedAt: stringValue(record['scannedAt']),
    scannerName: stringValue(record['scannerName']),
    scannerUserId: stringValue(record['scannerUserId']),
    deviceAttemptId: stringValue(record['deviceAttemptId']),
  };
}

function normalizeOfflineQueue(value: unknown): ScannerOfflineQueueItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): ScannerOfflineQueueItem | null => {
      const record = asRecord(item);
      const deviceAttemptId = stringValue(record?.['deviceAttemptId']);
      const attemptedAt = stringValue(record?.['attemptedAt']);
      const rawState =
        stringValue(record?.['state']) ?? stringValue(record?.['syncState']);
      if (!deviceAttemptId || !attemptedAt) {
        return null;
      }

      return {
        deviceAttemptId,
        attemptedAt,
        state: normalizeOfflineState(rawState),
        reason: stringValue(record?.['reason']) ?? stringValue(record?.['rejectionReason']),
      };
    })
    .filter((item): item is ScannerOfflineQueueItem => item !== null);
}

function normalizeOfflineState(
  value: string | null | undefined,
): ScannerOfflineQueueItem['state'] {
  if (value === 'synced' || value === 'rejected') {
    return value;
  }
  return 'pending';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}
