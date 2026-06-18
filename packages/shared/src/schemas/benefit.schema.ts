import { z } from 'zod';

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

const showtimeIdSchema = z.string().uuid('유효한 회차 ID가 필요합니다');
const ticketItemIdSchema = z.string().uuid('유효한 ticket item ID가 필요합니다');
const benefitEntitlementIdSchema = z
  .string()
  .uuid('유효한 benefit entitlement ID가 필요합니다');
const benefitRunIdSchema = z.string().uuid('유효한 benefit run ID가 필요합니다');
const benefitConfigurationIdSchema = z
  .string()
  .uuid('유효한 benefit configuration ID가 필요합니다');

export const BENEFIT_KINDS = ['included', 'limited'] as const;
export const BENEFIT_RUN_MODES = ['live', 'test'] as const;
export const BENEFIT_ENTITLEMENT_SOURCES = [
  'configuration',
  'live_run',
  'test_run',
  'rollback',
] as const;
export const BENEFIT_ENTITLEMENT_STATES = ['active', 'inactive', 'redeemed'] as const;
export const BENEFIT_REDEMPTION_OUTCOMES = [
  'redeemed',
  'duplicate',
  'not_eligible',
  'inactive',
  'tampered',
  'wrong_showtime',
] as const;

const BENEFIT_REDEMPTION_REJECTION_OUTCOMES = [
  'not_eligible',
  'inactive',
  'tampered',
  'wrong_showtime',
] as const;

export const ticketBenefitKindSchema = z.enum(BENEFIT_KINDS);
export const benefitRunModeSchema = z.enum(BENEFIT_RUN_MODES);
export const benefitEntitlementSourceSchema = z.enum(BENEFIT_ENTITLEMENT_SOURCES);
export const benefitEntitlementStateSchema = z.enum(BENEFIT_ENTITLEMENT_STATES);
export const benefitRedemptionOutcomeSchema = z.enum(BENEFIT_REDEMPTION_OUTCOMES);

const localizedBenefitCopySchema = z
  .object({
    name: z.string().trim().min(1, '혜택 이름이 필요합니다'),
    description: z.string().trim().min(1, '혜택 설명이 필요합니다'),
  })
  .strict();

export const ticketBenefitDisplayCopySchema = z
  .object({
    ko: localizedBenefitCopySchema,
    en: localizedBenefitCopySchema,
    'zh-CN': localizedBenefitCopySchema,
    th: localizedBenefitCopySchema,
  })
  .strict();

const benefitIdentitySchema = z.string().trim().min(1, 'benefit identity가 필요합니다');
const eligibleTierNamesSchema = z
  .array(z.string().trim().min(1, '혜택 적용 등급명이 필요합니다'))
  .min(1, '혜택 적용 등급이 필요합니다');

export const includedBenefitDefinitionSchema = z
  .object({
    identity: benefitIdentitySchema,
    kind: z.literal('included'),
    displayCopy: ticketBenefitDisplayCopySchema,
    eligibleTierNames: eligibleTierNamesSchema,
    quantity: z.never().optional(),
    selectionPriority: z.never().optional(),
    mutuallyExclusiveWith: z.array(benefitIdentitySchema).default([]),
  })
  .strict();

export const limitedBenefitDefinitionSchema = z
  .object({
    identity: benefitIdentitySchema,
    kind: z.literal('limited'),
    displayCopy: ticketBenefitDisplayCopySchema,
    eligibleTierNames: eligibleTierNamesSchema,
    quantity: z.number().int().positive('한정 혜택 수량은 1 이상이어야 합니다'),
    selectionPriority: z.number().int().positive('한정 혜택 우선순위는 1 이상이어야 합니다'),
    mutuallyExclusiveWith: z.array(benefitIdentitySchema).default([]),
  })
  .strict();

export const benefitDefinitionSchema = z.discriminatedUnion('kind', [
  includedBenefitDefinitionSchema,
  limitedBenefitDefinitionSchema,
]);

export const benefitConfigurationSchema = z
  .object({
    id: benefitConfigurationIdSchema,
    showtimeId: showtimeIdSchema,
    active: z.literal(true),
    version: z.number().int().positive('혜택 설정 버전은 1 이상이어야 합니다'),
    benefits: z.array(benefitDefinitionSchema).min(1, '혜택 설정이 필요합니다'),
    createdAt: isoDatetime('혜택 설정 생성 시각'),
    updatedAt: isoDatetime('혜택 설정 수정 시각'),
    activatedAt: isoDatetime('혜택 설정 활성화 시각'),
  })
  .strict();

export const benefitConfigurationChangeRecordSchema = z
  .object({
    id: z.string().min(1, '혜택 설정 변경 기록 ID가 필요합니다'),
    showtimeId: showtimeIdSchema,
    configurationId: benefitConfigurationIdSchema.nullable().optional(),
    action: z.enum(['created', 'updated', 'activated', 'deactivated', 'rolled_back']),
    actorUserId: z.string().min(1, '변경 작업자 ID가 필요합니다'),
    reason: z.string().trim().min(1).max(500).nullable().optional(),
    changedAt: isoDatetime('혜택 설정 변경 시각'),
    before: z.record(z.unknown()).nullable().optional(),
    after: z.record(z.unknown()).nullable().optional(),
  })
  .strict();

export const benefitEntitlementBaseSchema = z
  .object({
    id: benefitEntitlementIdSchema,
    ticketItemId: ticketItemIdSchema,
    showtimeId: showtimeIdSchema,
    runId: benefitRunIdSchema.nullable(),
    source: benefitEntitlementSourceSchema,
    benefitIdentity: benefitIdentitySchema,
    kind: ticketBenefitKindSchema,
    displayCopy: ticketBenefitDisplayCopySchema,
    state: benefitEntitlementStateSchema,
    assignedAt: isoDatetime('혜택 배정 시각'),
    redeemedAt: isoDatetime('혜택 사용 시각').nullable().optional(),
  })
  .strict();

const configurationBenefitEntitlementSchema = benefitEntitlementBaseSchema
  .extend({
    source: z.literal('configuration'),
    runId: z.null(),
    kind: z.literal('included'),
    attachedToTicket: z.literal(true),
    runMode: z.never().optional(),
  })
  .strict();

const liveRunBenefitEntitlementSchema = benefitEntitlementBaseSchema
  .extend({
    source: z.literal('live_run'),
    runId: benefitRunIdSchema,
    runMode: z.literal('live'),
    attachedToTicket: z.literal(true),
  })
  .strict();

const testRunBenefitEntitlementSchema = benefitEntitlementBaseSchema
  .extend({
    source: z.literal('test_run'),
    runId: benefitRunIdSchema,
    runMode: z.literal('test'),
    attachedToTicket: z.literal(false),
  })
  .strict();

const rollbackBenefitEntitlementSchema = benefitEntitlementBaseSchema
  .extend({
    source: z.literal('rollback'),
    attachedToTicket: z.literal(true),
    runMode: z.literal('live').optional(),
  })
  .strict();

export const benefitEntitlementSchema = z.discriminatedUnion('source', [
  configurationBenefitEntitlementSchema,
  liveRunBenefitEntitlementSchema,
  testRunBenefitEntitlementSchema,
  rollbackBenefitEntitlementSchema,
]);

const benefitConfigurationSnapshotSchema = z
  .object({
    active: z.literal(false),
    benefits: z.array(benefitDefinitionSchema).min(1, '혜택 설정 snapshot이 필요합니다'),
    capturedAt: isoDatetime('혜택 설정 snapshot 생성 시각').optional(),
    sourceConfigurationId: benefitConfigurationIdSchema.nullable().optional(),
  })
  .strict();

const benefitRunRecordBaseSchema = z
  .object({
    id: benefitRunIdSchema,
    showtimeId: showtimeIdSchema,
    configurationId: benefitConfigurationIdSchema.nullable().optional(),
    entitlementCount: z.number().int().min(0),
    createdByUserId: z.string().min(1, '혜택 실행 작업자 ID가 필요합니다'),
    startedAt: isoDatetime('혜택 실행 시작 시각'),
    completedAt: isoDatetime('혜택 실행 완료 시각').nullable().optional(),
  })
  .strict();

const liveBenefitRunRecordSchema = benefitRunRecordBaseSchema
  .extend({
    mode: z.literal('live'),
    attachedToTicket: z.literal(true),
    redactedSeedRef: z.string().trim().min(1, 'redacted seed reference가 필요합니다'),
    operatorProvidedSeedRef: z.never().optional(),
    configurationSnapshot: z.never().optional(),
  })
  .strict();

const testBenefitRunRecordSchema = benefitRunRecordBaseSchema
  .extend({
    mode: z.literal('test'),
    attachedToTicket: z.literal(false),
    redactedSeedRef: z.string().trim().min(1).optional(),
    operatorProvidedSeedRef: z.string().trim().min(1).optional(),
    configurationSnapshot: benefitConfigurationSnapshotSchema.optional(),
  })
  .strict();

export const benefitRunRecordSchema = z.discriminatedUnion('mode', [
  liveBenefitRunRecordSchema,
  testBenefitRunRecordSchema,
]);

export const benefitRunRecordListResponseSchema = z
  .object({
    runs: z.array(benefitRunRecordSchema),
    nextCursor: z.string().min(1).nullable().optional(),
  })
  .strict();

const liveBenefitRunRequestSchema = z
  .object({
    mode: z.literal('live'),
    showtimeId: showtimeIdSchema,
    configurationId: benefitConfigurationIdSchema,
    reason: z.string().trim().min(1).max(500).optional(),
    operatorProvidedSeedRef: z.never().optional(),
    configurationSnapshot: z.never().optional(),
  })
  .strict();

const testBenefitRunRequestSchema = z
  .object({
    mode: z.literal('test'),
    showtimeId: showtimeIdSchema,
    configurationId: benefitConfigurationIdSchema.nullable().optional(),
    operatorProvidedSeedRef: z.string().trim().min(1).optional(),
    configurationSnapshot: benefitConfigurationSnapshotSchema.optional(),
  })
  .strict();

export const benefitRunRequestSchema = z.discriminatedUnion('mode', [
  liveBenefitRunRequestSchema,
  testBenefitRunRequestSchema,
]);

export const benefitRollbackRequestSchema = z
  .object({
    showtimeId: showtimeIdSchema,
    sourceRunId: benefitRunIdSchema,
    sourceRunMode: z.literal('live'),
    reason: z
      .string({ required_error: '혜택 rollback 사유가 필요합니다' })
      .trim()
      .min(1, '혜택 rollback 사유가 필요합니다')
      .max(500),
    confirmed: z.literal(true, {
      errorMap: () => ({ message: '혜택 rollback 확인이 필요합니다' }),
    }),
  })
  .strict();

const benefitEntitlementExportRowBaseSchema = z
  .object({
    benefitEntitlementId: benefitEntitlementIdSchema,
    ticketItemId: ticketItemIdSchema,
    showtimeId: showtimeIdSchema,
    runId: benefitRunIdSchema.nullable(),
    source: benefitEntitlementSourceSchema,
    benefitIdentity: benefitIdentitySchema,
    benefitKind: ticketBenefitKindSchema,
    benefitNameKo: z.string().trim().min(1, '한국어 혜택 이름이 필요합니다'),
    state: benefitEntitlementStateSchema,
    assignedAt: isoDatetime('혜택 배정 시각'),
    redeemedAt: isoDatetime('혜택 사용 시각').nullable().optional(),
  })
  .strict();

export const benefitEntitlementExportRowSchema = z.discriminatedUnion('source', [
  benefitEntitlementExportRowBaseSchema
    .extend({
      source: z.literal('configuration'),
      runId: z.null(),
      benefitKind: z.literal('included'),
      attachedToTicket: z.literal(true),
      runMode: z.never().optional(),
    })
    .strict(),
  benefitEntitlementExportRowBaseSchema
    .extend({
      source: z.literal('live_run'),
      runId: benefitRunIdSchema,
      runMode: z.literal('live'),
      attachedToTicket: z.literal(true),
    })
    .strict(),
  benefitEntitlementExportRowBaseSchema
    .extend({
      source: z.literal('test_run'),
      runId: benefitRunIdSchema,
      runMode: z.literal('test'),
      attachedToTicket: z.literal(false),
    })
    .strict(),
  benefitEntitlementExportRowBaseSchema
    .extend({
      source: z.literal('rollback'),
      attachedToTicket: z.literal(true),
      runMode: z.literal('live').optional(),
    })
    .strict(),
]);

const benefitConfigurationExportRowBaseSchema = z
  .object({
    configurationId: benefitConfigurationIdSchema,
    showtimeId: showtimeIdSchema,
    active: z.boolean(),
    version: z.number().int().positive('혜택 설정 버전은 1 이상이어야 합니다'),
    benefitIdentity: benefitIdentitySchema,
    benefitNameKo: z.string().trim().min(1, '한국어 혜택 이름이 필요합니다'),
    eligibleTierNames: eligibleTierNamesSchema,
    mutuallyExclusiveWith: z.array(benefitIdentitySchema).default([]),
    exportedAt: isoDatetime('혜택 설정 내보내기 시각'),
  })
  .strict();

export const benefitConfigurationExportRowSchema = z.discriminatedUnion('benefitKind', [
  benefitConfigurationExportRowBaseSchema
    .extend({
      benefitKind: z.literal('included'),
      quantity: z.never().optional(),
      selectionPriority: z.never().optional(),
    })
    .strict(),
  benefitConfigurationExportRowBaseSchema
    .extend({
      benefitKind: z.literal('limited'),
      quantity: z.number().int().positive('한정 혜택 수량은 1 이상이어야 합니다'),
      selectionPriority: z.number().int().positive('한정 혜택 우선순위는 1 이상이어야 합니다'),
    })
    .strict(),
]);

export const benefitRedemptionRequestSchema = z
  .object({
    token: z.string().trim().min(1, 'QR token이 필요합니다'),
    showtimeId: showtimeIdSchema,
    benefitEntitlementId: benefitEntitlementIdSchema,
    deviceAttemptId: z
      .string({ required_error: 'device attempt ID가 필요합니다' })
      .trim()
      .min(1, 'device attempt ID가 필요합니다'),
    confirmed: z.literal(true, {
      errorMap: () => ({ message: '혜택 사용 확인이 필요합니다' }),
    }),
  })
  .strict();

const benefitPriorRedemptionSchema = z
  .object({
    redeemedAt: isoDatetime('이전 혜택 사용 시각'),
    scannerUserId: z.string().min(1).optional(),
    deviceAttemptId: z.string().min(1).optional(),
    redemptionEventId: z.string().min(1).optional(),
  })
  .strict();

const redeemedBenefitRedemptionResponseSchema = z
  .object({
    outcome: z.literal('redeemed'),
    benefitEntitlement: benefitEntitlementSchema,
    redemptionEventId: z.string().min(1),
    redeemedAt: isoDatetime('혜택 사용 시각'),
    priorRedemption: z.never().optional(),
  })
  .strict();

const duplicateBenefitRedemptionResponseSchema = z
  .object({
    outcome: z.literal('duplicate'),
    benefitEntitlement: benefitEntitlementSchema.nullable().optional(),
    redemptionEventId: z.string().min(1).nullable().optional(),
    redeemedAt: isoDatetime('혜택 사용 시각').nullable().optional(),
    priorRedemption: benefitPriorRedemptionSchema,
  })
  .strict();

const rejectedBenefitRedemptionResponseSchema = z
  .object({
    outcome: z.enum(BENEFIT_REDEMPTION_REJECTION_OUTCOMES),
    benefitEntitlement: benefitEntitlementSchema.nullable().optional(),
    rejectionReason: z.string().min(1).nullable().optional(),
    priorRedemption: z.never().optional(),
  })
  .strict();

export const benefitRedemptionResponseSchema = z.discriminatedUnion('outcome', [
  redeemedBenefitRedemptionResponseSchema,
  duplicateBenefitRedemptionResponseSchema,
  rejectedBenefitRedemptionResponseSchema,
]);

export type TicketBenefitKind = z.infer<typeof ticketBenefitKindSchema>;
export type TicketBenefitDisplayCopy = z.infer<typeof ticketBenefitDisplayCopySchema>;
export type BenefitDefinition = z.infer<typeof benefitDefinitionSchema>;
export type BenefitConfiguration = z.infer<typeof benefitConfigurationSchema>;
export type BenefitConfigurationChangeRecord = z.infer<
  typeof benefitConfigurationChangeRecordSchema
>;
export type BenefitEntitlement = z.infer<typeof benefitEntitlementSchema>;
export type BenefitEntitlementSource = z.infer<typeof benefitEntitlementSourceSchema>;
export type BenefitEntitlementState = z.infer<typeof benefitEntitlementStateSchema>;
export type BenefitRunMode = z.infer<typeof benefitRunModeSchema>;
export type BenefitRunRecord = z.infer<typeof benefitRunRecordSchema>;
export type BenefitRunRecordListResponse = z.infer<
  typeof benefitRunRecordListResponseSchema
>;
export type BenefitRunRequest = z.infer<typeof benefitRunRequestSchema>;
export type BenefitRollbackRequest = z.infer<typeof benefitRollbackRequestSchema>;
export type BenefitEntitlementExportRow = z.infer<
  typeof benefitEntitlementExportRowSchema
>;
export type BenefitConfigurationExportRow = z.infer<
  typeof benefitConfigurationExportRowSchema
>;
export type BenefitRedemptionRequest = z.infer<typeof benefitRedemptionRequestSchema>;
export type BenefitRedemptionOutcome = z.infer<typeof benefitRedemptionOutcomeSchema>;
export type BenefitRedemptionResponse = z.infer<typeof benefitRedemptionResponseSchema>;
