export interface DashboardSummaryDto {
  todayBookings: number;
  todayCancellationEvents: number;
  todayGrossRevenue: number;
  todayNegativeCancellationRevenue: number;
  todayNetRevenue: number;
}

export interface DashboardRevenueBucketDto {
  bucket: string;
  revenue: number;
  count: number;
}
export type DashboardRevenueDto = DashboardRevenueBucketDto[];

export interface DashboardGenreBucketDto {
  genre: string;
  count: number;
}
export type DashboardGenreDto = DashboardGenreBucketDto[];

export interface DashboardPaymentBucketDto {
  method: string;
  count: number;
}
export type DashboardPaymentDto = DashboardPaymentBucketDto[];

export interface DashboardTopPerformanceDto {
  performanceId: string;
  title: string;
  genre: string;
  posterUrl: string | null;
  bookingCount: number;
}
export type DashboardTopDto = DashboardTopPerformanceDto[];
