import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { LocalStrategy } from './strategies/local.strategy.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { KakaoStrategy } from './strategies/kakao.strategy.js';
import { NaverStrategy } from './strategies/naver.strategy.js';
import { GoogleStrategy } from './strategies/google.strategy.js';
import { UserModule } from '../user/user.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { ConsentModule } from '../consent/consent.module.js';
import { EmailModule } from './email/email.module.js';
import { authConfig } from '../../config/auth.config.js';

// WR-03: AuthModule 은 auth.jwtSecret 네임스페이스를 소비하므로 해당 config 를 명시적으로
//        forFeature 로 등록한다. AppModule 의 isGlobal ConfigModule 에만 의존하면 이 모듈
//        을 단독 테스트/재사용할 때 secret 이 undefined 가 되는 regression 여지가 생긴다.
@Module({
  imports: [
    ConfigModule.forFeature(authConfig),
    PassportModule,
    UserModule,
    SmsModule,
    ConsentModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(authConfig)],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: config.get<string>('auth.jwtExpiresIn', '15m') as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    KakaoStrategy,
    NaverStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
