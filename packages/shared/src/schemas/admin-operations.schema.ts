import { z } from 'zod';

export const ADMIN_CAPABILITIES = [
  'event.write',
  'event.publish',
  'support.manage',
  'support.escalate',
  'reservations.export_raw',
  'seat.disable',
  'seat.reactivate',
  'seat.manual_open',
  'banner.manage',
  'audit.read',
  'security.manage',
] as const;

export const ADMIN_CAPABILITY_BUNDLES = [
  'operator',
  'reviewer',
  'approver',
  'finance',
  'admin',
] as const;

type AdminCapabilityValue = (typeof ADMIN_CAPABILITIES)[number];
type AdminCapabilityBundleValue = (typeof ADMIN_CAPABILITY_BUNDLES)[number];

export const ADMIN_CAPABILITY_BUNDLE_CAPABILITIES = {
  operator: [
    'event.write',
    'support.manage',
    'support.escalate',
    'seat.disable',
    'seat.reactivate',
    'seat.manual_open',
    'banner.manage',
  ],
  reviewer: [
    'event.write',
    'support.manage',
    'support.escalate',
    'audit.read',
  ],
  approver: [
    'event.write',
    'event.publish',
    'banner.manage',
    'audit.read',
  ],
  finance: [
    'reservations.export_raw',
    'audit.read',
  ],
  admin: ADMIN_CAPABILITIES,
} as const satisfies Record<
  AdminCapabilityBundleValue,
  readonly AdminCapabilityValue[]
>;

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

const dateOnly = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}은 YYYY-MM-DD 형식이어야 합니다`);

export const adminCapabilitySchema = z.enum(ADMIN_CAPABILITIES);
export const adminCapabilityBundleSchema = z.enum(ADMIN_CAPABILITY_BUNDLES);
export const adminUserRoleSchema = z.enum(['user', 'admin']);
export const adminSeatOperationShowtimeIdSchema = z
  .string()
  .uuid('유효한 회차 ID가 필요합니다');

export const adminPublishLifecycleSchema = z.enum([
  'draft',
  'review',
  'publish_ready',
  'published',
]);

export const adminSupportCategorySchema = z.enum([
  'signup_identity',
  'booking',
  'seat',
  'payment',
  'reservation_confirmation',
  'cancellation_refund',
  'notification',
  'field_entry',
  'account',
  'overseas_user',
  'event_info',
  'general_inquiry',
]);

export const adminCsCategorySchema = z.enum([
  'payment_error',
  'refund_pending',
  'abuse_suspicion',
  'signup_failure',
  'booking_issue',
  'seat_issue',
  'entry_issue',
  'account_issue',
  'overseas_user',
  'general',
]);

export const adminOperationsInboxSourceSchema = z.enum([
  'qna',
  'cs_ticket',
  'refund_dispute',
  'notice_followup',
  'review_request',
]);

export const adminOperationsPrioritySchema = z.enum([
  'normal',
  'due_soon',
  'overdue',
  'escalated',
]);

export const adminOperationsStatusSchema = z.enum([
  'open',
  'in_progress',
  'resolved',
  'archived',
]);

export const adminOperationsInboxRowSchema = z.object({
  id: z.string().min(1),
  source: adminOperationsInboxSourceSchema,
  title: z.string().min(1),
  category: z.string().min(1),
  status: adminOperationsStatusSchema,
  priority: adminOperationsPrioritySchema,
  assignedBundle: adminCapabilityBundleSchema.nullable().optional(),
  dueAt: isoDatetime('SLA 마감 시각').nullable().optional(),
  createdAt: isoDatetime('생성 시각'),
  updatedAt: isoDatetime('수정 시각').nullable().optional(),
});

export const adminFaqAuthoringSchema = z.object({
  id: z.string().min(1).optional(),
  category: adminSupportCategorySchema,
  titleKo: z.string().min(1, '한국어 FAQ 제목이 필요합니다'),
  titleEn: z.string().min(1, '영어 FAQ 제목이 필요합니다'),
  bodyKo: z.string().min(1, '한국어 FAQ 내용이 필요합니다'),
  bodyEn: z.string().min(1, '영어 FAQ 내용이 필요합니다'),
  translationUse: z.enum(['manual', 'assisted_reviewed']).default('manual'),
  publishState: adminPublishLifecycleSchema.default('draft'),
});

export const adminNoticeAuthoringSchema = z.object({
  id: z.string().min(1).optional(),
  eventId: z.string().min(1).nullable().optional(),
  titleKo: z.string().min(1, '한국어 공지 제목이 필요합니다'),
  titleEn: z.string().min(1, '영어 공지 제목이 필요합니다'),
  bodyKo: z.string().min(1, '한국어 공지 내용이 필요합니다'),
  bodyEn: z.string().min(1, '영어 공지 내용이 필요합니다'),
  urgent: z.boolean().default(false),
  publishState: adminPublishLifecycleSchema.default('draft'),
  scheduledAt: isoDatetime('공지 예약 시각').nullable().optional(),
});

export const adminAuditActionSchema = z.enum([
  ...ADMIN_CAPABILITIES,
  'event.update',
  'refund.admin_refund',
  'support.assign',
  'support.resolve',
  'allowlist.update',
  'security.allowlist.update',
  'security.permission.update',
  'user.withdraw',
  'user.hard_delete',
]);

export const adminAuditEventSchema = z.object({
  id: z.string().min(1),
  actorUserId: z.string().min(1),
  action: adminAuditActionSchema,
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  status: z.enum(['success', 'denied', 'failed']),
  reason: z.string().min(1).nullable().optional(),
  changedFields: z.array(z.string().min(1)).default([]),
  diff: z.object({
    before: z.record(z.unknown()).nullable().optional(),
    after: z.record(z.unknown()).nullable().optional(),
  }).default({}),
  ipAddress: z.string().min(1).nullable().optional(),
  userAgent: z.string().min(1).nullable().optional(),
  createdAt: isoDatetime('감사 생성 시각'),
});

export const adminAllowlistRecordSchema = z.object({
  id: z.string().min(1),
  cidr: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['active', 'disabled', 'exception']),
  reason: z.string().min(1),
  createdByUserId: z.string().min(1),
  createdAt: isoDatetime('허용 목록 생성 시각'),
  expiresAt: isoDatetime('허용 목록 만료 시각').nullable().optional(),
});

export const adminReservationExportFilterSchema = z
  .object({
    eventId: z.string().min(1).optional(),
    tierName: z.string().min(1).optional(),
    zoneFloor: z.string().min(1).optional(),
    reservationStatus: z
      .enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED'])
      .optional(),
    audienceRegion: z.enum(['domestic', 'overseas']).optional(),
    paymentMethod: z.string().min(1).optional(),
    dateFrom: dateOnly('조회 시작일').optional(),
    dateTo: dateOnly('조회 종료일').optional(),
    exportType: z.enum(['masked', 'raw_pii']).default('masked'),
    reason: z.string().min(1, '원본 CSV 내보내기 사유를 입력해주세요').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.exportType === 'raw_pii' && !value.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: '원본 CSV 내보내기 사유를 입력해주세요',
      });
    }
  });

export const adminSeatOperationRequestSchema = z.object({
  operation: z.enum(['seat.disable', 'seat.reactivate', 'seat.manual_open']),
  showtimeId: adminSeatOperationShowtimeIdSchema,
  seatKey: z.string().min(1, '좌석 키가 필요합니다'),
  reservationId: z.string().min(1).optional(),
  reason: z
    .string({ required_error: '좌석 운영 사유를 입력해주세요' })
    .min(1, '좌석 운영 사유를 입력해주세요')
    .max(500),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: '좌석 운영 확인이 필요합니다' }),
  }),
});

export const adminSeatOperationHistorySchema = z.object({
  id: z.string().min(1),
  operation: adminSeatOperationRequestSchema.shape.operation,
  showtimeId: adminSeatOperationShowtimeIdSchema,
  seatKey: z.string().min(1),
  previousStatus: z.string().min(1),
  nextStatus: z.string().min(1),
  reason: z.string().min(1),
  actorUserId: z.string().min(1),
  auditEventId: z.string().min(1),
  createdAt: isoDatetime('좌석 운영 시각'),
});

export const adminSecurityStatusSchema = z.object({
  mfa: z.object({
    status: z.literal('deferred_accepted_risk'),
    note: z.string().min(1).optional(),
  }),
  ipAllowlist: z.object({
    mode: z.enum(['disabled', 'monitoring', 'enforced']),
    activeRecords: z.number().int().min(0),
    lastChangedAt: isoDatetime('IP allowlist 변경 시각').nullable().optional(),
  }),
  lastAuditEventAt: isoDatetime('최근 감사 이벤트 시각').nullable().optional(),
});

export const adminUserListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  role: adminUserRoleSchema.optional(),
  verification: z
    .enum([
      'all',
      'verified',
      'email_verified',
      'phone_verified',
      'email_unverified',
      'phone_unverified',
      'unverified',
    ])
    .default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminUserVerificationStateSchema = z.object({
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
});

export const adminUserReservationStatusSummarySchema = z.object({
  pendingPayment: z.number().int().min(0).default(0),
  confirmed: z.number().int().min(0).default(0),
  cancelled: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
});

export const adminUserReservationSummarySchema = z.object({
  total: z.number().int().min(0),
  statuses: adminUserReservationStatusSummarySchema,
  lastReservationAt: isoDatetime('최근 예매 시각').nullable(),
});

export const adminUserListItemSchema = z.object({
  id: z.string().min(1),
  maskedEmail: z.string().min(1),
  name: z.string().min(1),
  maskedPhone: z.string().min(1),
  role: adminUserRoleSchema,
  country: z.string().min(1),
  preferredLocale: z.string().min(1),
  marketingConsent: z.boolean(),
  adminCapabilityBundle: adminCapabilityBundleSchema.nullable(),
  adminCapabilities: z.array(adminCapabilitySchema),
  accountStatus: z.enum(['active', 'withdrawn']).default('active'),
  withdrawnAt: isoDatetime('탈퇴 처리 시각').nullable().optional(),
  withdrawalReason: z.string().nullable().optional(),
  withdrawalSource: z.enum(['self', 'admin']).nullable().optional(),
  verificationState: adminUserVerificationStateSchema,
  reservationSummary: adminUserReservationSummarySchema,
  lastActivityAt: isoDatetime('최근 활동 시각').nullable(),
  createdAt: isoDatetime('가입 시각'),
});

export const adminUserRecentReservationSchema = z.object({
  id: z.string().min(1),
  reservationNumber: z.string().min(1),
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED']),
  totalAmount: z.number().int().min(0),
  createdAt: isoDatetime('예매 생성 시각'),
  cancelledAt: isoDatetime('예매 취소 시각').nullable(),
});

export const adminUserSupportThreadSummarySchema = z.object({
  total: z.number().int().min(0),
  open: z.number().int().min(0),
  escalated: z.number().int().min(0),
  recentThreads: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    priority: z.string().min(1),
    category: z.string().min(1),
    createdAt: isoDatetime('CS 생성 시각'),
    updatedAt: isoDatetime('CS 수정 시각').nullable(),
  })),
});

export const adminUserDetailSchema = adminUserListItemSchema.extend({
  account: z.object({
    birthDate: z.string().min(1),
    gender: z.enum(['male', 'female', 'unspecified']),
    updatedAt: isoDatetime('수정 시각').nullable(),
  }),
  recentReservations: z.array(adminUserRecentReservationSchema),
  supportThreads: adminUserSupportThreadSummarySchema,
  recentAuditEvents: z.array(adminAuditEventSchema),
});

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserListItemSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const adminUserPermissionUpdateSchema = z
  .object({
    role: adminUserRoleSchema,
    adminCapabilityBundle: adminCapabilityBundleSchema.nullable().optional(),
    adminCapabilities: z.array(adminCapabilitySchema).default([]),
    reason: z
      .string({ required_error: '권한 변경 사유를 입력해주세요' })
      .trim()
      .min(1, '권한 변경 사유를 입력해주세요')
      .max(500),
    confirmed: z.literal(true, {
      errorMap: () => ({ message: '권한 변경 확인이 필요합니다' }),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'admin' && !value.adminCapabilityBundle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adminCapabilityBundle'],
        message: '관리자 권한 묶음이 필요합니다',
      });
    }

    if (
      value.role === 'user' &&
      (value.adminCapabilityBundle || value.adminCapabilities.length > 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adminCapabilities'],
        message: '일반 사용자는 관리자 권한을 가질 수 없습니다',
      });
    }
  });

export const adminUserWithdrawalSchema = z.object({
  reason: z
    .string({ required_error: '탈퇴 처리 사유를 입력해주세요' })
    .trim()
    .min(1, '탈퇴 처리 사유를 입력해주세요')
    .max(500),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: '탈퇴 처리 확인이 필요합니다' }),
  }),
});

export const adminUserHardDeleteSchema = z.object({
  reason: z
    .string({ required_error: 'DB 삭제 사유를 입력해주세요' })
    .trim()
    .min(1, 'DB 삭제 사유를 입력해주세요')
    .max(500),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: 'DB 삭제 확인이 필요합니다' }),
  }),
});

export const adminUserDeletionBlockerSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  count: z.number().int().min(0),
});

export const adminUserHardDeleteResponseSchema = z.object({
  deleted: z.boolean(),
  userId: z.string().min(1),
  blockers: z.array(adminUserDeletionBlockerSchema).default([]),
});

export type AdminCapability = z.infer<typeof adminCapabilitySchema>;
export type AdminCapabilityBundle = z.infer<typeof adminCapabilityBundleSchema>;
export type AdminUserRole = z.infer<typeof adminUserRoleSchema>;
export type AdminPublishLifecycle = z.infer<typeof adminPublishLifecycleSchema>;
export type AdminSupportCategory = z.infer<typeof adminSupportCategorySchema>;
export type AdminCsCategory = z.infer<typeof adminCsCategorySchema>;
export type AdminOperationsInboxRow = z.infer<typeof adminOperationsInboxRowSchema>;
export type AdminFaqAuthoringInput = z.infer<typeof adminFaqAuthoringSchema>;
export type AdminNoticeAuthoringInput = z.infer<typeof adminNoticeAuthoringSchema>;
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;
export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>;
export type AdminAllowlistRecord = z.infer<typeof adminAllowlistRecordSchema>;
export type AdminReservationExportFilter = z.infer<
  typeof adminReservationExportFilterSchema
>;
export type AdminSeatOperationRequest = z.infer<
  typeof adminSeatOperationRequestSchema
>;
export type AdminSeatOperationHistory = z.infer<
  typeof adminSeatOperationHistorySchema
>;
export type AdminSecurityStatus = z.infer<typeof adminSecurityStatusSchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type AdminUserVerificationState = z.infer<
  typeof adminUserVerificationStateSchema
>;
export type AdminUserReservationSummary = z.infer<
  typeof adminUserReservationSummarySchema
>;
export type AdminUserListItem = z.infer<typeof adminUserListItemSchema>;
export type AdminUserRecentReservation = z.infer<
  typeof adminUserRecentReservationSchema
>;
export type AdminUserSupportThreadSummary = z.infer<
  typeof adminUserSupportThreadSummarySchema
>;
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;
export type AdminUserPermissionUpdate = z.infer<
  typeof adminUserPermissionUpdateSchema
>;
export type AdminUserWithdrawalInput = z.infer<typeof adminUserWithdrawalSchema>;
export type AdminUserHardDeleteInput = z.infer<typeof adminUserHardDeleteSchema>;
export type AdminUserDeletionBlocker = z.infer<typeof adminUserDeletionBlockerSchema>;
export type AdminUserHardDeleteResponse = z.infer<
  typeof adminUserHardDeleteResponseSchema
>;
