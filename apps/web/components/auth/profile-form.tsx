'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type UserProfile,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PhoneVerification } from '@/components/auth/phone-verification';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { buildAuthRoute } from '@/lib/auth-return';
import Link from 'next/link';
import { getClientLocale } from '@/lib/i18n/client-copy';

const WITHDRAWAL_REDIRECT_FLAG = 'grabit:withdrawalRedirect';

interface ProfileFormProps {
  user: UserProfile;
  returnTo?: string | null;
}

type ProfileSettingsUser = UserProfile & {
  marketingConsent?: boolean | null;
};

type ProfileUpdatePayload = {
  name?: string;
  phone?: string;
  phoneVerificationToken?: string;
  preferredLocale?: SupportedLocale;
  marketingConsent?: boolean;
};

function getMarketingConsent(user: UserProfile): boolean {
  return (user as ProfileSettingsUser).marketingConsent === true;
}

export function ProfileForm({ user, returnTo }: ProfileFormProps) {
  const router = useRouter();
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).profile;
  const { setAuth, clearAuth, accessToken } = useAuthStore();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [preferredLocale, setPreferredLocale] = useState<SupportedLocale>(
    user.preferredLocale,
  );
  const [marketingConsent, setMarketingConsent] = useState(
    getMarketingConsent(user),
  );
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [isPhoneVerified, setIsPhoneVerified] = useState(user.isPhoneVerified);
  const [phoneVerificationToken, setPhoneVerificationToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Track whether phone was changed
  const phoneChanged = phone !== user.phone;
  const hasChanges =
    name !== user.name ||
    phoneChanged ||
    Boolean(phoneVerificationToken) ||
    preferredLocale !== user.preferredLocale ||
    marketingConsent !== getMarketingConsent(user);

  // Reset phone verification when phone changes
  useEffect(() => {
    if (phoneChanged || isEditingPhone) {
      setIsPhoneVerified(false);
      setPhoneVerificationToken('');
    } else {
      setIsPhoneVerified(user.isPhoneVerified);
    }
  }, [phone, phoneChanged, user.isPhoneVerified, isEditingPhone]);

  function handlePhoneVerified(verificationToken: string) {
    setIsPhoneVerified(true);
    setPhoneVerificationToken(verificationToken);
  }

  async function handleSave() {
    if (!hasChanges) return;
    if (phoneChanged && !isPhoneVerified) return;

    setIsSaving(true);
    try {
      const payload: ProfileUpdatePayload = {};
      if (name !== user.name) payload.name = name;
      if (phoneChanged || phoneVerificationToken) {
        payload.phone = phone;
        payload.phoneVerificationToken = phoneVerificationToken;
      }
      if (preferredLocale !== user.preferredLocale) {
        payload.preferredLocale = preferredLocale;
      }
      if (marketingConsent !== getMarketingConsent(user)) {
        payload.marketingConsent = marketingConsent;
      }

      const updatedUser = await apiClient.patch<ProfileSettingsUser>(
        '/api/v1/users/me',
        payload,
      );
      if (accessToken) {
        setAuth(accessToken, updatedUser);
      }
      setPhoneVerificationToken('');
      setIsEditingPhone(false);
      toast.success(copy.saved);
      if (returnTo && updatedUser.isEmailVerified && updatedUser.isPhoneVerified) router.push(returnTo);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : getVisibleCopy(locale).commonErrors.default;
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch {
      // Logout should clear state regardless
    } finally {
      clearAuth();
      toast.success(copy.loggedOut);
      router.push(getLocalizedPathname('/', locale));
    }
  }

  async function handleWithdraw() {
    setIsWithdrawing(true);
    try {
      await apiClient.post('/api/v1/users/me/withdrawal', {
        reason: withdrawReason.trim() || undefined,
        confirmed: true,
      });
      try {
        window.sessionStorage.setItem(WITHDRAWAL_REDIRECT_FLAG, '1');
      } catch {
        // Session storage may be unavailable in restricted browser contexts.
      }
      clearAuth();
      toast.success(copy.withdrawn);
      router.push(`${getLocalizedPathname('/auth', locale)}?withdrawn=1`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : copy.withdrawBlocked;
      toast.error(message);
      setWithdrawOpen(false);
    } finally {
      setIsWithdrawing(false);
    }
  }

  function formatBirthDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(date);
  }

  return (
    <div className="space-y-6">
      {returnTo && user.isEmailVerified && user.isPhoneVerified && <Link href={returnTo} className="inline-flex min-h-11 items-center font-semibold text-primary underline">{copy.returnToBooking}</Link>}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-500">{copy.accountStatus}</p>
            <p className="mt-1 text-base font-semibold text-gray-900">
              {user.role === 'admin' ? copy.adminAccount : copy.buyerAccount}
            </p>
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
              {user.isEmailVerified ? copy.emailVerified : copy.emailUnverified}
            </Badge>
            <Badge
              variant={user.isPhoneVerified ? 'default' : 'outline'}
              className={
                user.isPhoneVerified
                  ? 'bg-[#EEF6FF] text-[#1D5E9F]'
                  : 'text-gray-600'
              }
            >
              {user.isPhoneVerified ? copy.phoneVerified : copy.phoneUnverified}
            </Badge>
          </div>
        </div>
      </section>

      <div className="space-y-2">
        <Label>{copy.email}</Label>
        <p className="text-base text-gray-700">{user.email}</p>
        {!user.isEmailVerified && <Link href={buildAuthRoute('/auth/verify-email', locale, { email: user.email, returnTo: returnTo ?? `${getLocalizedPathname('/mypage', locale)}?tab=settings` })} className="inline-flex min-h-11 items-center font-semibold text-primary underline">{copy.verifyEmail}</Link>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-name">{copy.name}</Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>{copy.phone}</Label>
        {user.isPhoneVerified && !isEditingPhone ? <Button type="button" variant="outline" onClick={() => setIsEditingPhone(true)}>{copy.changePhone}</Button> : isEditingPhone ? <Button type="button" variant="ghost" onClick={() => { setPhone(user.phone); setPhoneVerificationToken(''); setIsEditingPhone(false); }}>{copy.cancelPhoneChange}</Button> : null}
        <PhoneVerification
          phone={phone}
          onPhoneChange={setPhone}
          onVerified={handlePhoneVerified}
          isVerified={isPhoneVerified}
          purpose="profile_phone_change"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-locale">{copy.preferredLocale}</Label>
        <select
          id="profile-locale"
          value={preferredLocale}
          onChange={(event) =>
            setPreferredLocale(event.target.value as SupportedLocale)
          }
          className="flex h-11 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-base text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0"
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_LABELS[locale].native} ({LOCALE_LABELS[locale].english})
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="min-w-0">
          <Label
            htmlFor="profile-marketing-consent"
            className="text-base font-semibold text-gray-900"
          >
            {copy.marketingConsent}
          </Label>
          <p className="mt-1 text-sm text-gray-600">
            {copy.marketingDescription}
          </p>
        </div>
        <Switch
          id="profile-marketing-consent"
          aria-label={copy.marketingConsent}
          checked={marketingConsent}
          onCheckedChange={setMarketingConsent}
        />
      </div>

      <div className="space-y-2">
        <Label>{copy.gender}</Label>
        <p className="text-base text-gray-700">
          {getVisibleCopy(locale).auth.signup[user.gender === 'male' ? 'genderMale' : user.gender === 'female' ? 'genderFemale' : 'genderUnspecified']}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{copy.birthDate}</Label>
        <p className="text-base text-gray-700">{formatBirthDate(user.birthDate)}</p>
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={!hasChanges || (phoneChanged && !isPhoneVerified) || isSaving}
        onClick={handleSave}
      >
        {isSaving ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {copy.saving}
          </>
        ) : (
          copy.save
        )}
      </Button>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3">
          <p className="text-base font-semibold text-gray-900">{copy.session}</p>
          <p className="mt-1 text-sm text-gray-600">
            {copy.sessionDescription}
          </p>
        </div>
        <Button
          variant="ghost"
          className="w-full text-gray-500"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            copy.logout
          )}
        </Button>
      </div>

      <section className="rounded-lg border border-[#FEE2E2] bg-white p-4">
        <div className="flex items-start gap-3">
          <XCircle className="mt-0.5 h-5 w-5 text-[#C62828]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-gray-900">{copy.withdrawTitle}</p>
            <p className="mt-1 text-sm text-gray-600">
              {copy.withdrawDescription}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="profile-withdraw-reason">{copy.withdrawReason}</Label>
            <Textarea
              id="profile-withdraw-reason"
              value={withdrawReason}
              onChange={(event) => setWithdrawReason(event.target.value)}
              placeholder={copy.optionalPlaceholder}
              className="min-h-24"
            />
          </div>
          <label className="flex min-h-11 items-start gap-3 rounded-lg bg-[#FEF2F2] p-3 text-sm text-[#991B1B]">
            <Checkbox
              checked={withdrawConfirmed}
              onCheckedChange={(checked) => setWithdrawConfirmed(checked === true)}
              aria-label={copy.withdrawConfirmAria}
            />
            <span className="font-semibold">
              {copy.withdrawConfirmText}
            </span>
          </label>
          <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={!withdrawConfirmed || isWithdrawing}
              onClick={() => setWithdrawOpen(true)}
            >
              {copy.withdrawCta}
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{copy.withdrawDialogTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {copy.withdrawDialogDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleWithdraw()}
                >
                  {copy.confirmWithdraw}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  );
}
