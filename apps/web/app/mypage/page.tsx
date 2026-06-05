'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Languages,
  Settings2,
  ShieldCheck,
  Ticket,
  UserRound,
  WalletCards,
} from 'lucide-react';
import {
  COUNTRY_OPTIONS,
  LOCALE_LABELS,
  type ReservationListItem,
  type ReservationStatus,
  type UserProfile,
} from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { AuthGuard } from '@/components/auth/auth-guard';
import { ProfileForm } from '@/components/auth/profile-form';
import { ReservationList } from '@/components/reservation/reservation-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useMyReservations } from '@/hooks/use-reservations';
import { getVisibleCopy, type VisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';

type MyPageTab = 'account' | 'wallet' | 'settings';
type AccountHubUser = UserProfile & {
  marketingConsent?: boolean | null;
};

const COUNTRY_LABELS: ReadonlyMap<string, string> = new Map(
  COUNTRY_OPTIONS.map((country) => [country.value, country.label]),
);

function resolveActiveTab(value: string | null): MyPageTab {
  if (value === 'wallet' || value === 'reservations') return 'wallet';
  if (value === 'settings' || value === 'profile') return 'settings';
  return 'account';
}

function getCountryLabel(countryCode: string) {
  return COUNTRY_LABELS.get(countryCode) ?? countryCode;
}

function getMarketingConsent(user: UserProfile) {
  return (user as AccountHubUser).marketingConsent === true;
}

function formatDateTime(dateString: string, locale: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getAccountAgeLabel(
  createdAt: string,
  copy: VisibleCopy['mypage'],
) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return copy.accountAgeUnknown;

  const days = Math.max(
    1,
    Math.floor((Date.now() - date.getTime()) / 86_400_000) + 1,
  );

  if (days < 30) return copy.accountAgeDays.replace('{count}', String(days));
  if (days < 365) {
    return copy.accountAgeMonths.replace('{count}', String(Math.floor(days / 30)));
  }
  return copy.accountAgeYears.replace('{count}', String(Math.floor(days / 365)));
}

function buildReservationSummary(reservations: ReservationListItem[]) {
  return reservations.reduce(
    (summary, reservation) => {
      summary.total += 1;
      summary[reservation.status] += 1;
      return summary;
    },
    {
      total: 0,
      CONFIRMED: 0,
      PENDING_PAYMENT: 0,
      CANCELLED: 0,
      FAILED: 0,
    } satisfies Record<ReservationStatus | 'total', number>,
  );
}

function getNextReservation(reservations: ReservationListItem[]) {
  const now = Date.now();
  return reservations
    .filter(
      (reservation) =>
        reservation.status === 'CONFIRMED' &&
        new Date(reservation.showDateTime).getTime() >= now,
    )
    .sort(
      (a, b) =>
        new Date(a.showDateTime).getTime() - new Date(b.showDateTime).getTime(),
    )[0];
}

export default function MyPage() {
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).mypage;
  const user = useAuthStore((s) => s.user);
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = resolveActiveTab(searchParams.get('tab'));

  const [filter, setFilter] = useState('all');
  const { data: reservations, isLoading, isFetching } = useMyReservations();

  const allReservations = useMemo(() => reservations ?? [], [reservations]);
  const reservationSummary = useMemo(
    () => buildReservationSummary(allReservations),
    [allReservations],
  );
  const filteredReservations = useMemo(
    () =>
      filter === 'all'
        ? allReservations
        : allReservations.filter((reservation) => reservation.status === filter),
    [allReservations, filter],
  );
  const nextReservation = useMemo(
    () => getNextReservation(allReservations),
    [allReservations],
  );

  function handleTabChange(value: string) {
    if (value === 'wallet') {
      router.replace('/mypage?tab=wallet');
    } else if (value === 'settings') {
      router.replace('/mypage?tab=settings');
    } else {
      router.replace('/mypage');
    }
  }

  return (
    <AuthGuard>
      <main className="flex flex-1 justify-center bg-[#F7F8FA] px-4 pt-6 pb-16 md:pt-10">
        <div className="w-full max-w-[960px]">
          <header className="mb-5 rounded-lg border border-gray-200 bg-white p-5 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold text-primary">{copy.titlePrefix}</p>
                <h1 className="mt-2 text-2xl font-semibold text-gray-950 md:text-3xl">
                  {copy.title.replace('{name}', user?.name ?? copy.fallbackName)}
                </h1>
                <p className="mt-2 text-sm text-gray-600 md:text-base">
                  {copy.description}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-100 p-2 text-center">
                <SummaryNumber label={copy.summary.total} value={reservationSummary.total} />
                <SummaryNumber
                  label={copy.summary.confirmed}
                  value={reservationSummary.CONFIRMED}
                />
                <SummaryNumber
                  label={copy.summary.cancelled}
                  value={reservationSummary.CANCELLED}
                />
              </div>
            </div>
          </header>

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="sticky top-0 z-10 h-auto rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
              <TabsTrigger
                value="account"
                className="h-11 gap-2 rounded-md border-b-0 text-sm data-[state=active]:bg-gray-950 data-[state=active]:text-white data-[state=active]:border-b-0 data-[state=active]:-mb-0"
              >
                <UserRound className="h-4 w-4" />
                {copy.tabs.account}
              </TabsTrigger>
              <TabsTrigger
                value="wallet"
                className="h-11 gap-2 rounded-md border-b-0 text-sm data-[state=active]:bg-gray-950 data-[state=active]:text-white data-[state=active]:border-b-0 data-[state=active]:-mb-0"
              >
                <WalletCards className="h-4 w-4" />
                {copy.tabs.wallet}
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="h-11 gap-2 rounded-md border-b-0 text-sm data-[state=active]:bg-gray-950 data-[state=active]:text-white data-[state=active]:border-b-0 data-[state=active]:-mb-0"
              >
                <Settings2 className="h-4 w-4" />
                {copy.tabs.settings}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="account" className="mt-5 min-h-0 rounded-none bg-transparent p-0">
              {user && (
                <AccountHub
                  user={user}
                  reservationSummary={reservationSummary}
                  nextReservation={nextReservation}
                  onWalletClick={() => handleTabChange('wallet')}
                  onSettingsClick={() => handleTabChange('settings')}
                />
              )}
            </TabsContent>

            <TabsContent value="wallet" className="mt-5 min-h-0 rounded-none bg-transparent p-0">
              <TicketWallet
                summary={reservationSummary}
                reservations={filteredReservations}
                isLoading={isLoading}
                isFetching={isFetching}
                filter={filter}
                onFilterChange={setFilter}
              />
            </TabsContent>

            <TabsContent value="settings" className="mt-5 min-h-0 rounded-none bg-transparent p-0">
              <section className="rounded-lg border border-gray-200 bg-white p-5 md:p-6">
                <div className="mb-6">
                  <p className="text-sm font-semibold text-primary">SETTINGS</p>
                  <h2 className="mt-2 text-xl font-semibold text-gray-950">
                    {locale === 'ko' ? '설정 센터' : copy.tabs.settings}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {getVisibleCopy(locale).profile.marketingDescription}
                  </p>
                </div>
                {user && <ProfileForm user={user} />}
              </section>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </AuthGuard>
  );
}

function SummaryNumber({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[72px]">
      <p className="text-lg font-semibold text-gray-950">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-gray-500">{label}</p>
    </div>
  );
}

function AccountHub({
  user,
  reservationSummary,
  nextReservation,
  onWalletClick,
  onSettingsClick,
}: {
  user: UserProfile;
  reservationSummary: Record<ReservationStatus | 'total', number>;
  nextReservation: ReservationListItem | undefined;
  onWalletClick: () => void;
  onSettingsClick: () => void;
}) {
  const locale = getClientLocale();
  const visibleCopy = getVisibleCopy(locale);
  const copy = visibleCopy.mypage;
  const profileCopy = visibleCopy.profile;
  const reservationCopy = visibleCopy.reservation;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="rounded-lg border border-gray-200 bg-white p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-primary">ACCOUNT</p>
            <h2 className="mt-2 text-xl font-semibold text-gray-950">
              {locale === 'ko' ? '계정 개요' : copy.tabs.account}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={user.isEmailVerified ? 'default' : 'outline'}
              className={
                user.isEmailVerified
                  ? 'bg-[#EAF8EF] text-[#176E38]'
                  : 'text-gray-600'
              }
            >
              {user.isEmailVerified
                ? profileCopy.emailVerified
                : profileCopy.emailUnverified}
            </Badge>
            <Badge
              variant={user.isPhoneVerified ? 'default' : 'outline'}
              className={
                user.isPhoneVerified
                  ? 'bg-[#EEF6FF] text-[#1D5E9F]'
                  : 'text-gray-600'
              }
            >
              {user.isPhoneVerified ? profileCopy.phoneVerified : profileCopy.phoneUnverified}
            </Badge>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <InfoTile label={profileCopy.name} value={user.name} />
          <InfoTile label={profileCopy.email} value={user.email} />
          <InfoTile label={profileCopy.phone} value={user.phone} />
          <InfoTile label={visibleCopy.auth.signup.countryLabel} value={getCountryLabel(user.country)} />
          <InfoTile
            label={profileCopy.preferredLocale}
            value={LOCALE_LABELS[user.preferredLocale].english}
            icon={<Languages className="h-4 w-4" />}
          />
          <InfoTile
            label={profileCopy.marketingConsent}
            value={
              locale === 'ko'
                ? getMarketingConsent(user) ? '동의' : '미동의'
                : getMarketingConsent(user) ? copy.marketingOn : copy.marketingOff
            }
            icon={<Bell className="h-4 w-4" />}
          />
          <InfoTile
            label={copy.tabs.account}
            value={user.role === 'admin' ? 'Admin' : copy.fallbackName}
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <InfoTile
            label={copy.accountAgeUnknown}
            value={getAccountAgeLabel(user.createdAt, copy)}
            icon={<CalendarDays className="h-4 w-4" />}
          />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Button type="button" className="justify-between" onClick={onWalletClick}>
            <span className="inline-flex items-center gap-2">
              <Ticket className="h-4 w-4" />
              {copy.viewWallet}
            </span>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="justify-between"
            onClick={onSettingsClick}
          >
            <span className="inline-flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              {copy.editSettings}
            </span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 md:p-6">
        <p className="text-sm font-semibold text-primary">TICKET WALLET</p>
        <h2 className="mt-2 text-xl font-semibold text-gray-950">
          {locale === 'ko' ? '티켓 요약' : copy.tabs.wallet}
        </h2>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <StatusTile label={copy.summary.total} value={reservationSummary.total} />
          <StatusTile label={reservationCopy.status.confirmed} value={reservationSummary.CONFIRMED} />
          <StatusTile label={reservationCopy.status.pendingPayment} value={reservationSummary.PENDING_PAYMENT} />
          <StatusTile label={copy.summary.cancelled} value={reservationSummary.CANCELLED} />
        </div>

        <div className="mt-5 rounded-lg bg-gray-50 p-4">
          <p className="text-sm font-semibold text-gray-900">{copy.nextReservation}</p>
          {nextReservation ? (
            <div className="mt-3">
              <p className="text-base font-semibold text-gray-950">
                {nextReservation.performanceTitle}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {formatDateTime(nextReservation.showDateTime, locale)}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {nextReservation.venue}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-600">
              {copy.noUpcoming}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function InfoTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="min-h-[76px] rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 break-words text-base font-semibold text-gray-950">
        {value}
      </p>
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-2xl font-semibold text-gray-950">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{label}</p>
    </div>
  );
}

function TicketWallet({
  summary,
  reservations,
  isLoading,
  isFetching,
  filter,
  onFilterChange,
}: {
  summary: Record<ReservationStatus | 'total', number>;
  reservations: ReservationListItem[];
  isLoading: boolean;
  isFetching: boolean;
  filter: string;
  onFilterChange: (filter: string) => void;
}) {
  const locale = getClientLocale();
  const visibleCopy = getVisibleCopy(locale);
  const mypageCopy = visibleCopy.mypage;
  const reservationCopy = visibleCopy.reservation;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">TICKET WALLET</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-950">
            {mypageCopy.tabs.wallet}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {mypageCopy.description}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatusTile label={mypageCopy.summary.total} value={summary.total} />
        <StatusTile label={reservationCopy.status.confirmed} value={summary.CONFIRMED} />
        <StatusTile
          label={reservationCopy.status.pendingPayment}
          value={summary.PENDING_PAYMENT}
        />
        <StatusTile label={reservationCopy.status.cancelled} value={summary.CANCELLED} />
        <StatusTile label={reservationCopy.status.failed} value={summary.FAILED} />
      </div>

      <div className="mt-6">
        <ReservationList
          reservations={reservations}
          isLoading={isLoading}
          isFetching={isFetching}
          filter={filter}
          onFilterChange={onFilterChange}
        />
      </div>
    </section>
  );
}
