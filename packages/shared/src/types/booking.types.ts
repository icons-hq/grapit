import type { ConsentCaptureItem } from '../schemas/consent.schema';

export type SeatState = 'available' | 'locked' | 'sold' | 'held' | 'disabled';

export interface SeatSelection {
  seatId: string;
  tierName: string;
  tierColor?: string;
  price: number;
  row: string;
  number: string;
}

export interface FloorAwareSeatSelection extends SeatSelection {
  floorKey: string;
  floorLabel: string;
  seatKey: string;
}

export interface QueueAdmissionContext {
  queueSessionId: string;
  admissionToken: string;
  refreshFamilyId: string;
  deviceSlotKey: string;
  admittedAt: string;
  activeUntilAt: string;
  reentryGraceUntilAt: string;
}

export type CancellationChangePolicy =
  | 'CANCEL_ONLY'
  | 'SAME_GRADE_CHANGE'
  | 'MANUAL_REOPEN_ONLY';

export interface BookingPolicy {
  maxTicketsPerOrder: number;
  cancellationChangePolicy: CancellationChangePolicy;
  sameGradeChangeEnabled: boolean;
  paymentWindowMinutes?: number;
  seatHoldMinutes?: number;
}

export type PaymentMethodType =
  | 'CARD'
  | 'VIRTUAL_ACCOUNT'
  | 'TRANSFER'
  | 'MOBILE_PHONE'
  | 'FOREIGN_EASY_PAY'
  | 'SIMPLE_PAY';

export type PaymentProvider =
  | 'CARD'
  | 'TOSS_PAY'
  | 'NAVER_PAY'
  | 'KAKAOPAY'
  | 'ALIPAY_PLUS'
  | 'TRUEMONEY';

export interface OverseasPaymentConsent {
  required: boolean;
  agreed: boolean;
  agreementVersion: string;
  agreedAt?: string | null;
  fxRateDisclaimer?: string | null;
  refundDelayNotice?: string | null;
}

export interface PaymentMethod {
  method: PaymentMethodType;
  provider: PaymentProvider;
  currency?: string;
  pendingUrlRequired?: boolean;
  overseasPaymentConsent?: OverseasPaymentConsent;
}

export interface LockSeatResponse {
  success: boolean;
  lockId: string;
  seatId: string;
  seatKey?: string;
  floorKey?: string;
  floorLabel?: string;
  expiresAt: number;
}

export interface UnlockAllResponse {
  unlockedSeats: string[];
}

export interface SeatUpdateEvent {
  seatId: string;
  seatKey?: string;
  floorKey?: string;
  status: SeatState;
  userId?: string;
}

export interface SeatStatusResponse {
  showtimeId: string;
  seats: Record<string, SeatState>;
}

export type ReservationStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'FAILED';

export type PaymentStatus =
  | 'READY'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'CANCELED'
  | 'ABORTED'
  | 'EXPIRED';

export type RefundTimelineState =
  | 'REQUESTED'
  | 'SENT_TO_PG'
  | 'PROCESSING_AT_PG'
  | 'COMPLETED'
  | 'FAILED';

export interface RefundTimeline {
  currentState: RefundTimelineState;
  requestedAt: string;
  sentToPgAt?: string | null;
  processedAtPgAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  expectedDepositAt?: string | null;
  customerServiceCtaVisible: boolean;
}

export type CancelledSeatHoldStatus = 'HELD' | 'RELEASED' | 'MANUAL_OPENED';

export interface CancelledSeatHold {
  status: CancelledSeatHoldStatus;
  releaseJobId?: string | null;
  releaseAt?: string | null;
  releaseWindowMinutes: {
    min: number;
    max: number;
  };
  manualOverrideAllowed: boolean;
}

export type QrTicketStatus = 'ACTIVE' | 'REVOKED' | 'USED' | 'EXPIRED';
export type QrTicketEntryStatus = 'NOT_ENTERED' | 'ENTERED';

export interface QrTicket {
  token: string;
  jti: string;
  status: QrTicketStatus;
  entryStatus?: QrTicketEntryStatus;
  enteredAt?: string | null;
  issuedAt: string;
  emailScheduledAt?: string | null;
  emailedAt?: string | null;
}

export interface ReservationListItem {
  id: string;
  reservationNumber: string;
  status: ReservationStatus;
  performanceTitle: string;
  posterUrl: string | null;
  showDateTime: string;
  venue: string;
  seats: FloorAwareSeatSelection[];
  totalAmount: number;
  createdAt: string;
}

export interface ReservationDetail extends ReservationListItem {
  paymentMethod: string;
  paidAt: string;
  cancelDeadline: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  paymentKey: string;
  queueAdmission: QueueAdmissionContext;
  paymentDeadlineAt: string;
  bookingPolicy: BookingPolicy;
  refundTimeline: RefundTimeline;
  cancelledSeatHold: CancelledSeatHold | null;
  qrTicket: QrTicket;
}

export interface PaymentInfo {
  paymentKey: string;
  method: string;
  amount: number;
  status: PaymentStatus;
  paidAt: string | null;
  paymentDeadlineAt?: string | null;
  paymentMethod?: PaymentMethod;
}

export interface BookingStats {
  totalBookings: number;
  totalRevenue: number;
  cancelRate: number;
}

export interface AdminBookingListItem {
  id: string;
  reservationNumber: string;
  userName: string;
  userPhone: string;
  performanceTitle: string;
  showDateTime: string;
  seats: FloorAwareSeatSelection[];
  totalAmount: number;
  status: ReservationStatus;
  createdAt: string;
}

export interface PrepareReservationRequest {
  orderId: string;
  showtimeId: string;
  seats: FloorAwareSeatSelection[];
  amount: number;
  consentItems: Array<ConsentCaptureItem & { sourceFlow: 'booking' }>;
  queueAdmission: QueueAdmissionContext;
  paymentDeadlineAt: string;
  bookingPolicy: BookingPolicy;
  paymentMethod: PaymentMethod;
}

export interface PrepareReservationResponse {
  reservationId: string;
  orderId: string;
  queueAdmission: QueueAdmissionContext;
  paymentDeadlineAt: string;
  bookingPolicy: BookingPolicy;
  paymentMethod: PaymentMethod;
}

export interface ConfirmPaymentRequest {
  paymentKey: string;
  orderId: string;
  amount: number;
}

export interface CancelReservationRequest {
  reason: string;
}

export interface AdminRefundRequest {
  reason: string;
}
