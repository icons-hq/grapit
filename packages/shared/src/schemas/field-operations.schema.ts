import { z } from 'zod';

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

const dateOnly = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}은 YYYY-MM-DD 형식이어야 합니다`);

const showtimeIdSchema = z.string().uuid('유효한 회차 ID가 필요합니다');

export const FIELD_CHECK_IN_OUTCOMES = [
  'processable',
  'entered',
  'duplicate',
  'tampered',
  'refunded_cancelled',
  'expired',
  'wrong_showtime',
  'already_used',
  'offline_pending',
  'synced',
  'rejected',
] as const;

export const FIELD_OFFLINE_SYNC_STATES = [
  'pending',
  'synced',
  'rejected',
] as const;

export const SETTLEMENT_EXPORT_DATASETS = [
  'entry_status',
  'no_show_reservations',
  'reservation_payment_refund_summary',
  'settlement_accounting_input',
] as const;

export const fieldCheckInOutcomeSchema = z.enum(FIELD_CHECK_IN_OUTCOMES);
export const fieldOfflineSyncStateSchema = z.enum(FIELD_OFFLINE_SYNC_STATES);
export const settlementExportDatasetSchema = z.enum(SETTLEMENT_EXPORT_DATASETS);

export const fieldCheckInVerifyRequestSchema = z
  .object({
    token: z.string().trim().min(1, 'QR token이 필요합니다').optional(),
    qrUrl: z.string().url('유효한 QR URL이 필요합니다').optional(),
    showtimeId: showtimeIdSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.token && !value.qrUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token'],
        message: 'QR token 또는 QR URL이 필요합니다',
      });
    }
  });

export const fieldCheckInTicketContextSchema = z
  .object({
    reservationNumber: z.string().min(1, '예매 번호가 필요합니다'),
    performanceTitle: z.string().min(1, '공연명이 필요합니다'),
    showtimeId: showtimeIdSchema,
    showtimeLabel: z.string().min(1, '회차 표시 정보가 필요합니다'),
    seatLabels: z.array(z.string().min(1)).default([]),
    ticketStatus: z.enum(['ACTIVE', 'REVOKED', 'USED', 'EXPIRED']),
    redactedTokenRef: z.string().min(1, 'redacted token reference가 필요합니다'),
    maskedJti: z.string().min(1, 'masked JTI가 필요합니다').optional(),
  })
  .strict();

export const fieldCheckInVerifyResponseSchema = z
  .object({
    outcome: fieldCheckInOutcomeSchema,
    processable: z.boolean(),
    ticket: fieldCheckInTicketContextSchema.nullable(),
    rejectionReason: z.string().min(1).nullable().optional(),
    priorScan: z
      .object({
        scannedAt: isoDatetime('이전 검표 시각'),
        scannerUserId: z.string().min(1).optional(),
        deviceAttemptId: z.string().min(1).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    verifiedAt: isoDatetime('검표 확인 시각'),
  })
  .strict();

export const fieldCheckInConsumeRequestSchema = z
  .object({
    token: z.string().trim().min(1, 'QR token이 필요합니다'),
    showtimeId: showtimeIdSchema,
    deviceAttemptId: z
      .string({ required_error: 'device attempt ID가 필요합니다' })
      .trim()
      .min(1, 'device attempt ID가 필요합니다'),
    confirmed: z.literal(true, {
      errorMap: () => ({ message: '입장 처리 확인이 필요합니다' }),
    }),
  })
  .strict();

export const fieldCheckInConsumeResponseSchema = z
  .object({
    outcome: fieldCheckInOutcomeSchema,
    ticket: fieldCheckInTicketContextSchema.nullable(),
    scanEventId: z.string().min(1).nullable().optional(),
    consumedAt: isoDatetime('입장 처리 시각').nullable().optional(),
    rejectionReason: z.string().min(1).nullable().optional(),
    priorScan: z
      .object({
        scannedAt: isoDatetime('이전 검표 시각'),
        scannerUserId: z.string().min(1).optional(),
        deviceAttemptId: z.string().min(1).optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const fieldOfflineSyncAttemptSchema = z
  .object({
    deviceAttemptId: z.string().trim().min(1, 'device attempt ID가 필요합니다'),
    scannerUserId: z.string().trim().min(1, 'scanner user ID가 필요합니다'),
    showtimeId: showtimeIdSchema,
    attemptedAt: isoDatetime('오프라인 시도 시각'),
    token: z.string().trim().min(1, 'QR token이 필요합니다'),
    redactedTokenRef: z.string().trim().min(1, 'redacted token reference가 필요합니다'),
    syncState: fieldOfflineSyncStateSchema,
    lastSyncAttemptAt: isoDatetime('마지막 동기화 시도 시각').nullable().optional(),
    rejectionReason: z.string().min(1).nullable().optional(),
  })
  .strict();

export const fieldOfflineSyncRequestSchema = z
  .object({
    attempts: z.array(fieldOfflineSyncAttemptSchema).min(1, '동기화할 시도가 필요합니다'),
  })
  .strict();

export const fieldOfflineSyncResultSchema = z
  .object({
    deviceAttemptId: z.string().min(1),
    syncState: z.enum(['synced', 'rejected']),
    outcome: fieldCheckInOutcomeSchema,
    resolvedAt: isoDatetime('동기화 해결 시각'),
    scanEventId: z.string().min(1).nullable().optional(),
    reason: z.string().min(1).nullable().optional(),
  })
  .strict();

export const fieldOfflineSyncResponseSchema = z
  .object({
    results: z.array(fieldOfflineSyncResultSchema),
  })
  .strict();

export const fieldMonitorAlertSchema = z
  .object({
    type: z.enum([
      'duplicate_spike',
      'rejected_tampered_scan',
      'refunded_cancelled_attempt',
      'offline_backlog',
      'sync_failure',
    ]),
    severity: z.enum(['info', 'warning', 'critical']),
    message: z.string().min(1),
    count: z.number().int().min(0).optional(),
    detectedAt: isoDatetime('이상 징후 감지 시각'),
  })
  .strict();

export const fieldMonitorSummarySchema = z
  .object({
    eventId: z.string().min(1, '이벤트 ID가 필요합니다'),
    showtimeId: showtimeIdSchema,
    enteredCount: z.number().int().min(0),
    notEnteredCount: z.number().int().min(0),
    entryRate: z.number().min(0).max(1),
    duplicateScanCount: z.number().int().min(0),
    rejectedScanCount: z.number().int().min(0),
    offlinePendingCount: z.number().int().min(0),
    offlineSyncedCount: z.number().int().min(0),
    latestAbnormalAlerts: z.array(fieldMonitorAlertSchema).default([]),
    updatedAt: isoDatetime('현장 모니터 갱신 시각'),
  })
  .strict();

export const fieldMonitorLogFilterSchema = z
  .object({
    eventId: z.string().min(1).optional(),
    showtimeId: showtimeIdSchema.optional(),
    outcome: fieldCheckInOutcomeSchema.optional(),
    syncState: fieldOfflineSyncStateSchema.optional(),
    scannerUserId: z.string().min(1).optional(),
    dateFrom: dateOnly('조회 시작일').optional(),
    dateTo: dateOnly('조회 종료일').optional(),
  })
  .strict();

export const fieldMonitorLogRowSchema = z
  .object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    showtimeId: showtimeIdSchema,
    outcome: fieldCheckInOutcomeSchema,
    syncState: fieldOfflineSyncStateSchema.nullable().optional(),
    scannerUserId: z.string().min(1),
    deviceAttemptId: z.string().min(1).nullable().optional(),
    redactedTokenRef: z.string().min(1),
    scannedAt: isoDatetime('검표 시각'),
    rejectionReason: z.string().min(1).nullable().optional(),
  })
  .strict();

export const settlementSummarySchema = z
  .object({
    eventId: z.string().min(1, '이벤트 ID가 필요합니다'),
    showtimeId: showtimeIdSchema.optional(),
    currency: z.string().min(1, '통화가 필요합니다'),
    grossSalesAmount: z.number().int().min(0),
    paidReservationCount: z.number().int().min(0),
    refundedAmount: z.number().int().min(0),
    refundCount: z.number().int().min(0),
    enteredCount: z.number().int().min(0),
    noShowCount: z.number().int().min(0),
    entryRate: z.number().min(0).max(1),
    generatedAt: isoDatetime('정산 요약 생성 시각'),
  })
  .strict();

export const settlementExportRequestSchema = z
  .object({
    eventId: z.string().min(1, '이벤트 ID가 필요합니다'),
    showtimeId: showtimeIdSchema.optional(),
    dataset: settlementExportDatasetSchema,
    reason: z.string().trim().min(1, '정산 내보내기 사유가 필요합니다').max(500),
    dateFrom: dateOnly('조회 시작일').optional(),
    dateTo: dateOnly('조회 종료일').optional(),
  })
  .strict();

export const settlementExportResponseSchema = z
  .object({
    exportId: z.string().min(1),
    dataset: settlementExportDatasetSchema,
    filename: z.string().min(1),
    rowCount: z.number().int().min(0),
    generatedAt: isoDatetime('정산 내보내기 생성 시각'),
    downloadUrl: z.string().url().nullable().optional(),
    expiresAt: isoDatetime('다운로드 만료 시각').nullable().optional(),
  })
  .strict();

export type FieldCheckInOutcome = z.infer<typeof fieldCheckInOutcomeSchema>;
export type FieldOfflineSyncState = z.infer<typeof fieldOfflineSyncStateSchema>;
export type SettlementExportDataset = z.infer<typeof settlementExportDatasetSchema>;
export type FieldCheckInVerifyRequest = z.infer<
  typeof fieldCheckInVerifyRequestSchema
>;
export type FieldCheckInVerifyResponse = z.infer<
  typeof fieldCheckInVerifyResponseSchema
>;
export type FieldCheckInConsumeRequest = z.infer<
  typeof fieldCheckInConsumeRequestSchema
>;
export type FieldCheckInConsumeResponse = z.infer<
  typeof fieldCheckInConsumeResponseSchema
>;
export type FieldOfflineSyncAttempt = z.infer<typeof fieldOfflineSyncAttemptSchema>;
export type FieldOfflineSyncRequest = z.infer<typeof fieldOfflineSyncRequestSchema>;
export type FieldOfflineSyncResult = z.infer<typeof fieldOfflineSyncResultSchema>;
export type FieldOfflineSyncResponse = z.infer<typeof fieldOfflineSyncResponseSchema>;
export type FieldMonitorAlert = z.infer<typeof fieldMonitorAlertSchema>;
export type FieldMonitorSummary = z.infer<typeof fieldMonitorSummarySchema>;
export type FieldMonitorLogFilter = z.infer<typeof fieldMonitorLogFilterSchema>;
export type FieldMonitorLogRow = z.infer<typeof fieldMonitorLogRowSchema>;
export type SettlementSummary = z.infer<typeof settlementSummarySchema>;
export type SettlementExportRequest = z.infer<typeof settlementExportRequestSchema>;
export type SettlementExportResponse = z.infer<typeof settlementExportResponseSchema>;
