import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-kakao';
import { ConfigService } from '@nestjs/config';
import type { SocialProfile } from '../interfaces/social-profile.interface.js';

interface KakaoProfile {
  id: string;
  displayName: string;
  _json: {
    kakao_account?: {
      email?: string;
      is_email_valid?: boolean;
      is_email_verified?: boolean;
    };
    properties?: {
      nickname?: string;
    };
  };
}

@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy, 'kakao') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.get<string>('KAKAO_CLIENT_ID', 'not-configured'),
      clientSecret: configService.get<string>('KAKAO_CLIENT_SECRET', 'not-configured'),
      callbackURL: configService.get<string>('KAKAO_CALLBACK_URL', 'http://localhost:8080/api/v1/auth/social/kakao/callback'),
    });
  }

  extractProfile(profile: KakaoProfile): SocialProfile {
    const account = profile._json?.kakao_account;
    const email = account?.email;
    const name =
      profile.displayName || profile._json?.properties?.nickname || '';

    return {
      provider: 'kakao',
      providerId: String(profile.id),
      email,
      // Kakao marks an email trustworthy only when it is both verified and still valid.
      emailVerified: Boolean(email) && account?.is_email_verified === true && account?.is_email_valid !== false,
      name,
    };
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: KakaoProfile,
  ): Promise<SocialProfile> {
    return this.extractProfile(profile);
  }
}
