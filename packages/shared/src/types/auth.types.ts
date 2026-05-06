import type { UserProfile } from './user.types';

export interface AuthResponse {
  accessToken: string;
  user: UserProfile;
  deviceLimitNotice?: string;
}

export interface TokenRefreshResponse {
  accessToken: string;
}

export interface SocialAuthResult {
  status: 'authenticated' | 'needs_registration';
  accessToken?: string;
  refreshToken?: string;
  registrationToken?: string;
  user?: UserProfile;
  socialProfile?: {
    provider: string;
    providerId: string;
    email?: string;
    name?: string;
  };
}
