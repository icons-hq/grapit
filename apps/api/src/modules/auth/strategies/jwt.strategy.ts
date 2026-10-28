import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../../user/user.repository.js';
import { prepareJwtVerificationKey } from '../../../common/jwt-verification-key.js';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  adminCapabilityBundle?: string | null;
  adminCapabilities?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly userRepository: UserRepository,
  ) {
    const options = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: prepareJwtVerificationKey(configService.get<string>('auth.jwtSecret')!),
    };
    // passport-jwt 4 forwards this value unchanged to jsonwebtoken 9, which
    // supports KeyObject. Its separate @types package still lists only
    // string/Buffer; the real authenticate path is covered in the spec.
    super(options as unknown as StrategyOptionsWithoutRequest);
  }

  async validate(payload: JwtPayload) {
    const user = await this.userRepository.findAuthPrincipalById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다');
    }
    if (user.accountStatus === 'withdrawn' || user.accountStatus === 'merged') {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      adminCapabilityBundle: user.adminCapabilityBundle ?? null,
      adminCapabilities: user.adminCapabilities ?? [],
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
    };
  }
}
