'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FieldCheckInConsumeRequest,
  FieldCheckInConsumeResponse,
  FieldCheckInVerifyRequest,
  FieldCheckInVerifyResponse,
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
  seats: string[];
  ticketStatus?: string;
  rejectionReason?: string | null;
  priorScanContext?: ScannerPriorScanContext | null;
  offlineQueue: ScannerOfflineQueueItem[];
  verifiedAt?: string;
}

export interface ScannerCheckInConsumeResult {
  result: ScannerCheckInResult;
  resultLabel: string;
  consumedAt?: string | null;
  rejectionReason?: string | null;
  priorScanContext?: ScannerPriorScanContext | null;
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

export function normalizeVerifyResponse(
  response: FieldCheckInVerifyResponse | Record<string, unknown>,
): ScannerCheckInVerification {
  const record = asRecord(response);
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
    verifiedAt: stringValue(record['verifiedAt']),
  };
}

export function normalizeConsumeResponse(
  response: FieldCheckInConsumeResponse | Record<string, unknown>,
): ScannerCheckInConsumeResult {
  const record = asRecord(response);
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

function normalizeResult(
  value: string | null | undefined,
  processable?: boolean | null,
): ScannerCheckInResult {
  if (processable) {
    return 'processable';
  }

  switch (value) {
    case 'processable':
      return 'processable';
    case 'entered':
    case 'processed':
      return 'processed';
    case 'duplicate':
    case 'already_used':
    case 'already-used':
      return 'duplicate';
    case 'refunded':
    case 'refunded_cancelled':
    case 'refunded-cancelled':
      return 'refunded';
    case 'wrong_showtime':
    case 'wrong-showtime':
      return 'wrong-showtime';
    case 'offline_pending':
    case 'offline-pending':
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
    .map((item) => {
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

function normalizeOfflineState(value: string | null | undefined) {
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
