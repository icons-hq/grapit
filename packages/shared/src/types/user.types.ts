import type { SupportedLocale } from './i18n.types';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  phone: string;
  gender: 'male' | 'female' | 'unspecified';
  country: string;
  birthDate: string;
  preferredLocale: SupportedLocale;
  isPhoneVerified: boolean;
  role: 'user' | 'admin';
  createdAt: string;
}
