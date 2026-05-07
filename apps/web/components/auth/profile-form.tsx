'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { UserProfile } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneVerification } from '@/components/auth/phone-verification';

const GENDER_LABELS: Record<string, string> = {
  male: '남성',
  female: '여성',
  unspecified: '선택안함',
};

interface ProfileFormProps {
  user: UserProfile;
}

export function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter();
  const { setAuth, clearAuth, accessToken } = useAuthStore();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [isPhoneVerified, setIsPhoneVerified] = useState(true);
  const [phoneVerificationToken, setPhoneVerificationToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Track whether phone was changed
  const phoneChanged = phone !== user.phone;
  const hasChanges = name !== user.name || phoneChanged;

  // Reset phone verification when phone changes
  useEffect(() => {
    if (phoneChanged) {
      setIsPhoneVerified(false);
      setPhoneVerificationToken('');
    } else {
      setIsPhoneVerified(true);
    }
  }, [phone, phoneChanged]);

  function handlePhoneVerified(verificationToken: string) {
    setIsPhoneVerified(true);
    setPhoneVerificationToken(verificationToken);
  }

  async function handleSave() {
    if (!hasChanges) return;
    if (phoneChanged && !isPhoneVerified) return;

    setIsSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (name !== user.name) payload.name = name;
      if (phoneChanged) {
        payload.phone = phone;
        payload.phoneVerificationToken = phoneVerificationToken;
      }

      const updatedUser = await apiClient.patch<UserProfile>(
        '/api/v1/users/me',
        payload,
      );
      if (accessToken) {
        setAuth(accessToken, updatedUser);
      }
      toast.success('프로필이 수정되었습니다');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
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
      toast.success('로그아웃되었습니다');
      router.push('/');
    }
  }

  function formatBirthDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  }

  return (
    <div className="space-y-6">
      {/* Email - read only */}
      <div className="space-y-2">
        <Label>이메일</Label>
        <p className="text-base text-gray-700">{user.email}</p>
      </div>

      {/* Name - editable */}
      <div className="space-y-2">
        <Label htmlFor="profile-name">이름</Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* Phone - editable with re-verify */}
      <div className="space-y-2">
        <Label>전화번호</Label>
        <PhoneVerification
          phone={phone}
          onPhoneChange={setPhone}
          onVerified={handlePhoneVerified}
          isVerified={isPhoneVerified}
          purpose="profile_phone_change"
        />
      </div>

      {/* Gender - read only */}
      <div className="space-y-2">
        <Label>성별</Label>
        <p className="text-base text-gray-700">
          {GENDER_LABELS[user.gender] ?? user.gender}
        </p>
      </div>

      {/* Birth date - read only */}
      <div className="space-y-2">
        <Label>생년월일</Label>
        <p className="text-base text-gray-700">{formatBirthDate(user.birthDate)}</p>
      </div>

      {/* Save button */}
      <Button
        size="lg"
        className="w-full"
        disabled={!hasChanges || (phoneChanged && !isPhoneVerified) || isSaving}
        onClick={handleSave}
      >
        {isSaving ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            저장 중...
          </>
        ) : (
          '변경사항 저장'
        )}
      </Button>

      {/* Logout */}
      <div className="pt-4">
        <Button
          variant="ghost"
          className="w-full text-gray-500"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            '로그아웃'
          )}
        </Button>
      </div>
    </div>
  );
}
