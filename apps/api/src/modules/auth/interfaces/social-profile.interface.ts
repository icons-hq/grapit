export interface SocialProfile {
  provider: string;
  providerId: string;
  email?: string;
  /**
   * True only when the provider explicitly asserts that it verified `email`
   * (Google `email_verified`, Kakao `is_email_verified`). Providers without such
   * an assertion leave it false so Grabit runs its own email verification.
   */
  emailVerified?: boolean;
  name?: string;
}
