// Real-time seat types (Phase 3 - booking gateway/service)
import type { ConsentCaptureItem } from '../schemas/consent.schema';

export type SeatState = 'available' | 'locked' | 'sold';

export interface LockSeatResponse {
  success: boolean;
  lockId: string;
  seatId: string;
  expiresAt: number;
}

export interface UnlockAllResponse {
  unlockedSeats: string[];
}

export interface SeatUpdateEvent {
  seatId: string;
  status: SeatState;
  userId?: string;
}

export interface SeatStatusResponse {
  showtimeId: string;
  seats: Record<string, SeatState>;
}

export type ReservationStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'FAILED';

export type PaymentStatus = 'READY' | 'DONE' | 'CANCELED' | 'ABORTED' | 'EXPIRED';

export interface SeatSelection {
  seatId: string;
  tierName: string;
  tierColor?: string;
  price: number;
  row: string;
  number: string;
}

export interface ReservationListItem {
  id: string;
  reservationNumber: string;
  status: ReservationStatus;
  performanceTitle: string;
  posterUrl: string | null;
  showDateTime: string;
  venue: string;
  seats: SeatSelection[];
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
}

export interface PaymentInfo {
  paymentKey: string;
  method: string;
  amount: number;
  status: PaymentStatus;
  paidAt: string | null;
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
  seats: SeatSelection[];
  totalAmount: number;
  status: ReservationStatus;
  createdAt: string;
}

export interface PrepareReservationRequest {
  orderId: string;
  showtimeId: string;
  seats: SeatSelection[];
  amount: number;
  consentItems: Array<ConsentCaptureItem & { sourceFlow: 'booking' }>;
}

export interface PrepareReservationResponse {
  reservationId: string;
  orderId: string;
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
