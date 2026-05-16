import type { UserProfile } from './user.types';

export interface AuthResponse {
  accessToken: string;
  user: UserProfile;
  deviceLimitNotice?: string;
}

export interface RegistrationPendingResponse {
  emailVerificationRequired: true;
  email: string;
  verificationExpiresAt: string;
  user: UserProfile;
}

export type RegisterResponse = AuthResponse | RegistrationPendingResponse;

export interface EmailAvailabilityResponse {
  available: boolean;
}

export interface TokenRefreshResponse {
  accessToken: string;
}

export type SocialAuthResult =
  | {
      status: 'authenticated';
      accessToken: string;
      refreshToken: string;
      deviceLimitNotice?: string;
      user: UserProfile;
    }
  | {
      status: 'needs_registration';
      registrationToken: string;
      socialProfile: {
        provider: string;
        providerId: string;
        email?: string;
        name?: string;
      };
    }
  | {
      status: 'email_verification_required';
      email: string;
      verificationExpiresAt: Date;
      user: UserProfile;
    };
