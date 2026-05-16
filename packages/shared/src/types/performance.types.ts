export const GENRES = ['artist_celebrity', 'ip_popup'] as const;
export type EventCategory = typeof GENRES[number];

export const LEGACY_GENRES = [
  'musical', 'concert', 'play', 'exhibition',
  'classic', 'sports', 'kids_family', 'leisure_camping',
] as const;
export type LegacyGenre = typeof LEGACY_GENRES[number];

export const PERFORMANCE_GENRES = [...LEGACY_GENRES, ...GENRES] as const;
export type Genre = typeof PERFORMANCE_GENRES[number];

export const GENRE_LABELS: Record<Genre, string> = {
  artist_celebrity: '아티스트',
  ip_popup: 'IP 팝업',
  musical: '뮤지컬',
  concert: '콘서트',
  play: '연극',
  exhibition: '전시',
  classic: '클래식',
  sports: '스포츠',
  kids_family: '아동/가족',
  leisure_camping: '레저/캠핑',
};

export const GENRE_SLUGS: Record<string, Genre> = {
  '아티스트': 'artist_celebrity',
  '아티스트·셀럽': 'artist_celebrity',
  '아티스트/셀럽': 'artist_celebrity',
  'IP 팝업': 'ip_popup',
  '뮤지컬': 'musical',
  '콘서트': 'concert',
  '연극': 'play',
  '전시': 'exhibition',
  '클래식': 'classic',
  '스포츠': 'sports',
  '아동/가족': 'kids_family',
  '레저/캠핑': 'leisure_camping',
};

export const PERFORMANCE_STATUSES = [
  'upcoming',
  'selling',
  'closing_soon',
  'ended',
] as const;
export type PerformanceStatus = typeof PERFORMANCE_STATUSES[number];
export type TranslationReviewSource = 'machine_reviewed';

export const PERFORMANCE_PUBLISH_LIFECYCLE = [
  'draft',
  'review',
  'publish_ready',
  'published',
] as const;
export type PerformancePublishLifecycle =
  typeof PERFORMANCE_PUBLISH_LIFECYCLE[number];

export const BANNER_PLACEMENTS = [
  'home_hero',
  'home_secondary',
  'performance_detail',
  'operations_notice',
] as const;
export type BannerPlacement = typeof BANNER_PLACEMENTS[number];

export const BANNER_DEVICE_TARGETS = ['all', 'desktop', 'mobile'] as const;
export type BannerDeviceTarget = typeof BANNER_DEVICE_TARGETS[number];

export const BANNER_STATUSES = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'expired',
] as const;
export type BannerStatus = typeof BANNER_STATUSES[number];

export interface ReviewedTranslationMetadata {
  automaticTranslationLabel?: boolean;
  translatedBy?: TranslationReviewSource;
}

export const STATUS_LABELS: Record<PerformanceStatus, string> = {
  upcoming: '오픈예정',
  selling: '오픈',
  closing_soon: '마감임박',
  ended: '판매종료',
};

export interface Venue {
  id: string;
  name: string;
  address: string | null;
  accessNotes?: string | null;
  transportSummary?: string | null;
}

export interface VenueLayout {
  id: string;
  venueId: string;
  layoutName: string;
  version: number;
  isActive: boolean;
  sourceSvgUrl: string | null;
  normalizedSvgUrl: string | null;
  stagePosition: 'top' | 'right' | 'bottom' | 'left';
}

export interface VenueLayoutFloor {
  id: string;
  layoutId: string;
  floorKey: string;
  floorLabel: string;
  sortOrder: number;
  svgUrl: string | null;
}

export interface VenueLayoutSection {
  id: string;
  floorId: string;
  sectionKey: string;
  sectionLabel: string;
  sortOrder: number;
}

export interface VenueLayoutSeat {
  id: string;
  layoutId: string;
  floorId: string;
  sectionId: string | null;
  seatKey: string;
  sourceSeatId: string;
  rowLabel: string | null;
  seatNumber: string | null;
  isAccessible: boolean;
  sortOrder: number;
}

export interface PriceTier {
  id: string;
  performanceId: string;
  tierName: string;
  price: number;
  sortOrder: number;
}

export interface Showtime {
  id: string;
  performanceId: string;
  dateTime: string; // ISO string
}

export interface CastMember {
  id: string;
  performanceId: string;
  actorName: string;
  roleName: string | null;
  photoUrl: string | null;
  sortOrder: number;
}

export interface PerformanceDetailImage {
  imageUrl: string;
  altText?: string | null;
  sortOrder: number;
}

export interface SeatMapConfig {
  tiers: Array<{
    tierName: string;
    color: string;
    seatIds: string[];
  }>;
}

export const PERFORMANCE_ALLOWED_PAYMENT_METHODS = [
  'CARD',
  'VIRTUAL_ACCOUNT',
  'TRANSFER',
  'MOBILE_PHONE',
  'FOREIGN_EASY_PAY',
  'SIMPLE_PAY',
] as const;
export type PerformanceAllowedPaymentMethod =
  typeof PERFORMANCE_ALLOWED_PAYMENT_METHODS[number];

export interface SeatMap {
  id: string;
  performanceId: string;
  venueLayoutId?: string | null;
  floorKey: string;
  floorLabel: string;
  sortOrder: number;
  svgUrl: string;
  seatConfig: SeatMapConfig | null;
  totalSeats: number;
}

export interface PerformanceSeatTier {
  id: string;
  performanceId: string;
  tierName: string;
  color: string;
  price: number;
  sortOrder: number;
}

export type PerformanceSeatSaleStatus = 'available' | 'blocked';

export interface PerformanceSeatAssignment {
  id: string;
  performanceId: string;
  layoutSeatId: string;
  tierId: string;
  saleStatus: PerformanceSeatSaleStatus;
  blockReason: string | null;
}

export interface PerformanceBookingPolicy {
  maxTicketsPerUser: number;
  allowedPaymentMethods: PerformanceAllowedPaymentMethod[];
  changePolicyEnabled: boolean;
  paymentWindowMinutes: number;
  seatHoldMinutes: number;
  cancelledSeatHoldMinMinutes: number;
  cancelledSeatHoldMaxMinutes: number;
  manualOpenEnabled: boolean;
}

export const DEFAULT_PERFORMANCE_BOOKING_POLICY: PerformanceBookingPolicy = {
  maxTicketsPerUser: 1,
  allowedPaymentMethods: ['CARD'],
  changePolicyEnabled: false,
  paymentWindowMinutes: 7,
  seatHoldMinutes: 10,
  cancelledSeatHoldMinMinutes: 1,
  cancelledSeatHoldMaxMinutes: 10,
  manualOpenEnabled: true,
};

export interface Banner {
  id: string;
  imageUrl: string;
  linkUrl: string | null;
  placement: BannerPlacement;
  deviceTarget: BannerDeviceTarget;
  status: BannerStatus;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Performance extends ReviewedTranslationMetadata {
  id: string;
  title: string;
  genre: Genre;
  subcategory: string | null;
  venueId: string | null;
  posterUrl: string | null;
  description: string | null;
  startDate: string; // ISO string
  endDate: string;   // ISO string
  runtime: string | null;
  ageRating: string;
  status: PerformanceStatus;
  publishState?: PerformancePublishLifecycle;
  publishReviewRequestedAt?: string | null;
  publishReadyAt?: string | null;
  publishedAt?: string | null;
  publishedByUserId?: string | null;
  salesInfo: string | null;
  detailImages?: PerformanceDetailImage[];
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceWithDetails extends Performance {
  venue: Venue | null;
  priceTiers: PriceTier[];
  showtimes: Showtime[];
  castings: CastMember[];
  seatMaps: SeatMap[];
  bookingPolicy: PerformanceBookingPolicy;
  // Transitional compatibility alias for existing consumers until the
  // booking/admin UI fully migrates to seatMaps[].
  seatMap: SeatMap | null;
}

export interface PerformanceCardData extends ReviewedTranslationMetadata {
  id: string;
  title: string;
  genre: Genre;
  posterUrl: string | null;
  status: PerformanceStatus;
  startDate: string;
  endDate: string;
  venueName: string | null;
}

export interface PerformanceListResponse {
  data: PerformanceCardData[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SearchResponse extends PerformanceListResponse {
  query: string;
}
