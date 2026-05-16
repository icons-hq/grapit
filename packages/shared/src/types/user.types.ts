import type { SupportedLocale } from './i18n.types';
import type { AdminCapability, AdminCapabilityBundle } from './admin-operations.types';

export type UserRole = 'user' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  phone: string;
  gender: 'male' | 'female' | 'unspecified';
  country: string;
  birthDate: string;
  preferredLocale: SupportedLocale;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  role: UserRole;
  adminCapabilityBundle?: AdminCapabilityBundle | null;
  adminCapabilities?: AdminCapability[];
  createdAt: string;
}
