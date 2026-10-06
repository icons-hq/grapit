import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-naver-v2';
import { ConfigService } from '@nestjs/config';
import type { SocialProfile } from '../interfaces/social-profile.interface.js';

interface NaverProfile {
  id: string;
  displayName: string;
  emails?: Array<{ value: string }>;
}

// Cast needed: passport-naver-v2 transitively references @types/passport-oauth2
// which TS cannot name in declaration emit without it as a direct dependency (TS2742)
const NaverPassportStrategy = PassportStrategy(Strategy, 'naver') as new (
  ...args: unknown[]
) => InstanceType<ReturnType<typeof PassportStrategy>>;

@Injectable()
export class NaverStrategy extends NaverPassportStrategy {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.get<string>('NAVER_CLIENT_ID', 'not-configured'),
      clientSecret: configService.get<string>('NAVER_CLIENT_SECRET', 'not-configured'),
      callbackURL: configService.get<string>('NAVER_CALLBACK_URL', 'http://localhost:8080/api/v1/auth/social/naver/callback'),
    });
  }

  extractProfile(profile: NaverProfile): SocialProfile {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName || '';

    return {
      provider: 'naver',
      providerId: String(profile.id),
      email,
      // Naver's profile API does not assert that this address was verified.
      emailVerified: false,
      name,
    };
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: NaverProfile,
  ): Promise<SocialProfile> {
    return this.extractProfile(profile);
  }
}
