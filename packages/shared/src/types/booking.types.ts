import type { ConsentCaptureItem } from '../schemas/consent.schema';
import type { TicketItem } from '../schemas/ticket-item.schema';

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
  | 'TRUEMONEY'
  | 'PAYPAL';

export interface OverseasPaymentConsent {
  required: boolean;
  agreed: boolean;
  agreementVersion: string;
  agreedAt?: string | null;
  fxRateDisclaimer?: string | null;
  refundDelayNotice?: string | null;
}

export interface ProviderChargeQuote {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: string;
}

export type TicketEmailDeliveryStatus =
  | 'verification_required'
  | 'ready'
  | 'sent';

export interface TicketEmailDelivery {
  email: string;
  isEmailVerified: boolean;
  isPlaceholderEmail: boolean;
  canSend: boolean;
  status: TicketEmailDeliveryStatus;
  scheduledAt: string | null;
  lastSentAt: string | null;
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

export interface QrTicketSeatIdentity {
  seatId: string;
  seatKey: string;
  floorKey: string;
  floorLabel: string;
  row: string;
  number: string;
  tierName: string;
}

export interface QrTicket {
  id?: string;
  ticketItemId?: string | null;
  seatIdentity?: QrTicketSeatIdentity;
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
  performanceId?: string;
  showtimeId?: string;
  tossOrderId?: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  cancelDeadline: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  paymentKey: string | null;
  paymentInfo: PaymentInfo | null;
  queueAdmission: QueueAdmissionContext;
  paymentDeadlineAt: string;
  bookingPolicy: BookingPolicy;
  refundTimeline: RefundTimeline;
  cancelledSeatHold: CancelledSeatHold | null;
  qrTicket: QrTicket;
  ticketEmailDelivery: TicketEmailDelivery;
  ticketItems: TicketItem[];
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
  soldCount: number;
  pendingPaymentCount: number;
  paymentProcessingCount: number;
  failedCount: number;
  cancelProcessingCount: number;
  cancelledCount: number;
  partialCancelledCount: number;
  completedRevenue: number;
}

export interface AdminBookingTierStats {
  tierName: string;
  price: number;
  soldSeats: number;
  activeRevenue: number;
  averageTicketAmount: number;
  cancelProcessingSeats: number;
  cancelledSeats: number;
  enteredSeats: number;
  totalSeats: number | null;
  remainingSeats: number | null;
  sellThroughRate: number | null;
}

export type AdminBookingFunnelStatus =
  | 'SOLD'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_FAILED'
  | 'CANCEL_PROCESSING'
  | 'CANCELLED'
  | 'PARTIAL_CANCELLED';

export interface AdminTicketStatusCounts {
  ACTIVE: number;
  CANCELLATION_PENDING: number;
  CANCELLED: number;
  EXPIRED: number;
}

export interface AdminBookingListItem {
  id: string;
  reservationNumber: string;
  tossOrderId: string | null;
  userName: string;
  userEmail: string;
  userCountry: string;
  performanceTitle: string;
  showDateTime: string;
  seats: FloorAwareSeatSelection[];
  totalAmount: number;
  status: ReservationStatus;
  funnelStatus: AdminBookingFunnelStatus;
  paymentStatus: PaymentStatus | null;
  paymentMethod: string | null;
  ticketStatusCounts: AdminTicketStatusCounts;
  createdAt: string;
}

export interface AdminBookingListResponse {
  bookings: AdminBookingListItem[];
  stats: BookingStats;
  tierStats: AdminBookingTierStats[];
  total: number;
}

export type AdminTicketItemStatus =
  | 'ACTIVE'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'EXPIRED';

export type AdminTicketItemAdmissionState = 'NOT_ENTERED' | 'ENTERED';

export type AdminTicketItemReopenState =
  | 'NOT_REQUIRED'
  | 'HELD_CANCELLED'
  | 'AVAILABLE'
  | 'MANUAL_OPENED';

export interface AdminTicketItem extends FloorAwareSeatSelection {
  id: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  serviceFee: number;
  status: AdminTicketItemStatus;
  admissionState: AdminTicketItemAdmissionState;
  enteredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
  reopenState: AdminTicketItemReopenState;
  reopenHoldUntil: string | null;
}

export interface AdminBookingDetail extends AdminBookingListItem {
  userPhone: string;
  paymentInfo: PaymentInfo | null;
  ticketItems: AdminTicketItem[];
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
  providerChargeQuote?: ProviderChargeQuote;
  checkoutEnabled?: boolean;
  disabledReason?: string;
}

export type ConfirmPaymentRequest = {
  paymentKey: string;
  orderId: string;
  amount: number;
  provider?: never;
  providerChargeAmount?: never;
} | {
  paymentKey: string;
  orderId: string;
  provider: 'PAYPAL';
  providerChargeAmount: string;
  amount?: never;
} | {
  paymentKey: string;
  orderId: string;
  provider: 'OVERSEAS_CARD';
  providerChargeAmount: string;
  amount?: never;
};

export interface CancelReservationRequest {
  reason: string;
}

export interface CancelTicketItemRequest {
  reason: string;
}

export interface AdminRefundRequest {
  reason: string;
}
