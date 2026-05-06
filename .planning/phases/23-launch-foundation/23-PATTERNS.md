# Phase 23: Launch Foundation - Pattern Map

**Mapped:** 2026-05-06 KST  
**Files analyzed:** 49 planned new/modified files  
**Analogs found:** 49 / 49

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/shared/src/flags.ts` | utility | transform | `packages/shared/src/constants/index.ts` | role-match |
| `packages/shared/src/constants/locales.ts` | config | transform | `packages/shared/src/constants/index.ts` | role-match |
| `packages/shared/src/schemas/consent.schema.ts` | model | request-response | `packages/shared/src/schemas/auth.schema.ts` | role-match |
| `packages/shared/src/types/i18n.types.ts` | model | transform | `packages/shared/src/types/user.types.ts` | role-match |
| `packages/shared/src/index.ts` | config | transform | `packages/shared/src/index.ts` | exact |
| `packages/shared/src/constants/index.ts` | config | transform | `packages/shared/src/constants/index.ts` | exact |
| `apps/api/src/modules/feature-flags/feature-flags.service.ts` | service | transform | `apps/api/src/modules/payment/payment.service.ts` | role-match |
| `apps/api/src/modules/feature-flags/feature-flags.module.ts` | provider | request-response | `apps/api/src/modules/user/user.module.ts` | role-match |
| `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts` | test | transform | `apps/api/src/modules/booking/__tests__/booking.service.spec.ts` | role-match |
| `apps/api/src/modules/booking/booking.service.ts` | service | event-driven | `apps/api/src/modules/booking/booking.service.ts` | exact |
| `apps/api/src/modules/reservation/reservation.service.ts` | service | CRUD | `apps/api/src/modules/reservation/reservation.service.ts` | exact |
| `apps/api/src/modules/payment/toss-payments.client.ts` | service | request-response | `apps/api/src/modules/payment/toss-payments.client.ts` | exact |
| `apps/api/src/modules/auth/auth.controller.ts` | controller | request-response | `apps/api/src/modules/auth/auth.controller.ts` | exact |
| `apps/api/src/modules/auth/auth.service.ts` | service | CRUD | `apps/api/src/modules/auth/auth.service.ts` | exact |
| `apps/api/src/modules/auth/auth.module.ts` | provider | request-response | `apps/api/src/modules/auth/auth.module.ts` | exact |
| `apps/api/src/modules/auth/email/email.service.ts` | service | request-response | `apps/api/src/modules/auth/email/email.service.ts` | exact |
| `apps/api/src/modules/auth/email/templates/email-verification.tsx` | component | request-response | `apps/api/src/modules/auth/email/templates/password-reset.tsx` | exact |
| `apps/api/src/modules/sms/sms.controller.ts` | controller | request-response | `apps/api/src/modules/sms/sms.controller.ts` | exact |
| `apps/api/src/modules/sms/sms.service.ts` | service | request-response | `apps/api/src/modules/sms/sms.service.ts` | exact |
| `apps/api/src/modules/sms/phone.util.ts` | utility | transform | `apps/api/src/modules/sms/phone.util.ts` | exact |
| `apps/api/src/modules/consent/consent.controller.ts` | controller | request-response | `apps/api/src/modules/user/user.controller.ts` | role-match |
| `apps/api/src/modules/consent/consent.service.ts` | service | CRUD | `apps/api/src/modules/user/user.repository.ts` | role-match |
| `apps/api/src/modules/consent/consent-audit.controller.ts` | controller | request-response | `apps/api/src/modules/admin/admin-dashboard.controller.ts` | role-match |
| `apps/api/src/modules/consent/consent.module.ts` | provider | request-response | `apps/api/src/modules/admin/admin.module.ts` | role-match |
| `apps/api/src/modules/translation/translation.controller.ts` | controller | request-response | `apps/api/src/modules/admin/admin-dashboard.controller.ts` | role-match |
| `apps/api/src/modules/translation/translation.service.ts` | service | CRUD | `apps/api/src/modules/admin/admin-dashboard.service.ts` | role-match |
| `apps/api/src/modules/translation/deepl.client.ts` | service | request-response | `apps/api/src/modules/payment/toss-payments.client.ts` | role-match |
| `apps/api/src/database/schema/users.ts` | model | CRUD | `apps/api/src/database/schema/users.ts` | exact |
| `apps/api/src/database/schema/refresh-tokens.ts` | model | CRUD | `apps/api/src/database/schema/refresh-tokens.ts` | exact |
| `apps/api/src/database/schema/consent-*.ts` | model | CRUD | `apps/api/src/database/schema/terms-agreements.ts` | role-match |
| `apps/api/src/database/schema/translation-*.ts` | model | CRUD | `apps/api/src/database/schema/performances.ts` | role-match |
| `apps/api/src/database/schema/index.ts` | config | transform | `apps/api/src/database/schema/index.ts` | exact |
| `apps/api/src/database/migrations/0007_phase23_launch_foundation.sql` | migration | batch | `apps/api/src/database/migrations/0000_deep_bloodaxe.sql` | role-match |
| `apps/web/i18n/routing.ts` | config | request-response | `apps/web/proxy.ts` | role-match |
| `apps/web/i18n/request.ts` | config | request-response | `apps/web/app/layout.tsx` | partial |
| `apps/web/messages/{ko,en,th,zh-CN,zh-TW}.json` | config | transform | `apps/web/components/layout/footer.tsx` | partial |
| `apps/web/proxy.ts` | middleware | request-response | `apps/web/proxy.ts` | exact |
| `apps/web/app/layout.tsx` | provider | request-response | `apps/web/app/layout.tsx` | exact |
| `apps/web/app/sitemap.ts` | route | transform | `apps/web/app/legal/terms/page.tsx` | role-match |
| `apps/web/components/i18n/locale-switcher.tsx` | component | event-driven | `apps/web/components/ui/phone-input.tsx` | role-match |
| `apps/web/components/i18n/locale-suggestion.tsx` | component | event-driven | `apps/web/components/layout/network-banner.tsx` | role-match |
| `apps/web/components/ui/phone-input.tsx` | component | event-driven | `apps/web/components/ui/phone-input.tsx` | exact |
| `apps/web/components/auth/signup-step2.tsx` | component | event-driven | `apps/web/components/auth/signup-step2.tsx` | exact |
| `apps/web/components/auth/email-verification*.tsx` | component | request-response | `apps/web/components/auth/phone-verification.tsx` | role-match |
| `apps/web/components/booking/booking-page.tsx` | component | event-driven | `apps/web/components/booking/booking-page.tsx` | exact |
| `apps/web/hooks/use-booking.ts` | hook | request-response | `apps/web/hooks/use-booking.ts` | exact |
| `apps/web/app/admin/translations/page.tsx` | component | CRUD | `apps/web/app/admin/performances/page.tsx` | role-match |
| `apps/web/components/admin/translation-review-table.tsx` | component | CRUD | `apps/web/components/admin/admin-booking-table.tsx` | role-match |
| `apps/web/app/admin/consent-audit/page.tsx` | component | CRUD | `apps/web/app/admin/performances/page.tsx` | role-match |
| `apps/web/components/admin/consent-audit-table.tsx` | component | CRUD | `apps/web/components/admin/admin-booking-table.tsx` | role-match |
| `apps/web/components/admin/admin-sidebar.tsx` | component | event-driven | `apps/web/components/admin/admin-sidebar.tsx` | exact |
| `apps/web/content/legal/*.md` | config | file-I/O | `apps/web/content/legal/*.md` | exact |
| `apps/web/app/legal/*/page.tsx` | route | file-I/O | `apps/web/app/legal/terms/page.tsx` | exact |
| `apps/web/components/layout/footer.tsx` | component | event-driven | `apps/web/components/layout/footer.tsx` | exact |
| `apps/web/**/*.{test,spec}.ts(x)` | test | request-response | existing API/web Vitest specs | role-match |

## Pattern Assignments

### Shared flags, locale constants, consent schemas

**Apply to:** `packages/shared/src/flags.ts`, `packages/shared/src/constants/locales.ts`, `packages/shared/src/schemas/consent.schema.ts`, `packages/shared/src/types/i18n.types.ts`, `packages/shared/src/index.ts`

**Analog:** `packages/shared/src/index.ts`, `packages/shared/src/constants/index.ts`, `packages/shared/src/schemas/auth.schema.ts`

**Export pattern** (`packages/shared/src/index.ts` lines 1-16):
```typescript
// Schemas
export * from './schemas/auth.schema';
export * from './schemas/user.schema';
export * from './schemas/performance.schema';
export * from './schemas/booking.schema';
export * from './schemas/admin-dashboard.schema';

// Types
export * from './types/auth.types';
export * from './types/user.types';
export * from './types/performance.types';
export * from './types/booking.types';
export * from './types/admin-dashboard.types';

// Constants
export * from './constants/index';
```

**Constant style** (`packages/shared/src/constants/index.ts` lines 1-15):
```typescript
export const AUTH_COOKIE_NAME = 'refreshToken';
export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY_DAYS = 7;
export const SMS_CODE_LENGTH = 6;
export const SMS_CODE_EXPIRY_SECONDS = 180;
export const SMS_RESEND_COOLDOWN_SECONDS = 30;
```

**Zod schema + inferred type pattern** (`packages/shared/src/schemas/auth.schema.ts` lines 33-44):
```typescript
export const registerStep2Schema = z.object({
  termsOfService: z.literal(true, {
    errorMap: () => ({ message: '이용약관에 동의해주세요' }),
  }),
  privacyPolicy: z.literal(true, {
    errorMap: () => ({ message: '개인정보처리방침에 동의해주세요' }),
  }),
  marketingConsent: z.boolean(),
});

export type RegisterStep2Input = z.infer<typeof registerStep2Schema>;
```

**Planner note:** `flags.ts` should export `FLAG_NAMES`, `parseBooleanFlag`, and `readFeatureFlags(env)`. Do not use `NEXT_PUBLIC_BOOKING_ENABLED` as the source of truth because Phase 23 needs Cloud Run runtime toggling.

---

### API booking/payment hard gates

**Apply to:** `apps/api/src/modules/feature-flags/*`, `apps/api/src/modules/booking/booking.service.ts`, `apps/api/src/modules/reservation/reservation.service.ts`, `apps/api/src/modules/payment/toss-payments.client.ts`

**Analog:** `BookingService`, `ReservationService`, `TossPaymentsClient`

**DI/import style** (`apps/api/src/modules/booking/booking.service.ts` lines 1-10, 222-228):
```typescript
import { Injectable, Inject, ConflictException } from '@nestjs/common';
import type IORedis from 'ioredis';
import { eq, and } from 'drizzle-orm';
import { REDIS_CLIENT } from './providers/redis.provider.js';
import { DRIZZLE } from '../../database/drizzle.provider.js';
import type { DrizzleDB } from '../../database/drizzle.provider.js';

@Injectable()
export class BookingService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly gateway: BookingGateway,
  ) {}
```

**Seat lock creation point to gate first** (`apps/api/src/modules/booking/booking.service.ts` lines 234-287):
```typescript
async lockSeat(userId: string, showtimeId: string, seatId: string): Promise<LockSeatResponse> {
  const [soldRecord] = await this.db
    .select({ id: seatInventories.id })
    .from(seatInventories)
    .where(and(
      eq(seatInventories.showtimeId, showtimeId),
      eq(seatInventories.seatId, seatId),
      eq(seatInventories.status, 'sold'),
    ));

  if (soldRecord) {
    throw new ConflictException('이미 판매된 좌석입니다');
  }
  // Redis Lua lock follows...
}
```

**Reservation prepare creation point to gate** (`apps/api/src/modules/reservation/reservation.service.ts` lines 199-207, 278-318):
```typescript
async prepareReservation(
  dto: PrepareReservationRequest,
  userId: string,
): Promise<PrepareReservationResponse> {
  this.assertUniqueSeatIds(dto.seats);

  const [existing] = await this.db
    .select({ id: reservations.id, userId: reservations.userId })
    .from(reservations)
    .where(eq(reservations.tossOrderId, dto.orderId));

  await this.bookingService.assertOwnedSeatLocks(
    userId,
    dto.showtimeId,
    canonicalSeats.map((seat) => seat.seatId),
  );

  const result = await this.db.transaction(async (tx) => {
    const [reservation] = await tx.insert(reservations).values({
      userId,
      showtimeId: dto.showtimeId,
      tossOrderId: dto.orderId,
      status: 'PENDING_PAYMENT',
      totalAmount: expectedAmount,
      cancelDeadline,
    }).returning();
    return reservation!;
  });
}
```

**Payment confirm path to gate before Toss call** (`apps/api/src/modules/reservation/reservation.service.ts` lines 321-347, 464-469):
```typescript
async confirmAndCreateReservation(dto: ConfirmPaymentRequest, userId: string) {
  const confirmLockToken = randomUUID();
  const confirmLockAcquired = await this.bookingService.acquirePaymentConfirmLock(
    dto.orderId,
    confirmLockToken,
  );
  if (!confirmLockAcquired) {
    throw new ConflictException('결제 확인이 이미 진행 중입니다.');
  }

  return await this.confirmAndCreateReservationLocked(dto, userId, confirmLockToken);
}

const tossResponse = await this.tossClient.confirmPayment({
  paymentKey: dto.paymentKey,
  orderId: dto.orderId,
  amount: dto.amount,
});
```

**External client error style** (`apps/api/src/modules/payment/toss-payments.client.ts` lines 18-25, 41-70):
```typescript
export class TossPaymentError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TossPaymentError';
    this.code = code;
  }
}

async confirmPayment(params: { paymentKey: string; orderId: string; amount: number }) {
  const response = await fetch(`${this.baseUrl}/payments/confirm`, {
    method: 'POST',
    headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const errorBody = data as Record<string, unknown>;
    throw new TossPaymentError(
      typeof errorBody.code === 'string' ? errorBody.code : 'UNKNOWN_ERROR',
      typeof errorBody.message === 'string' ? errorBody.message : '결제 승인에 실패했습니다',
    );
  }
  return data as TossPaymentResponse;
}
```

**Test analogs:** extend `apps/api/src/modules/booking/__tests__/booking.service.spec.ts` lines 79-157 and `apps/api/src/modules/reservation/reservation.service.spec.ts` lines 391-408, 921-984. Tests must prove `BOOKING_ENABLED=false` stops Redis lock, reservation transaction, and Toss confirm.

---

### Auth, email verification, refresh token family cap

**Apply to:** `auth.controller.ts`, `auth.service.ts`, `auth.module.ts`, `email.service.ts`, `email-verification.tsx`, `refresh-tokens.ts`, `users.ts`

**Analog:** existing auth/password reset/social/session code

**Controller validation/throttle/cookie pattern** (`apps/api/src/modules/auth/auth.controller.ts` lines 50-63, 82-100, 118-141, 254-261):
```typescript
@Public()
@Post('register')
async register(
  @Body(new ZodValidationPipe(registerBodySchema)) dto: RegisterBody,
  @Res({ passthrough: true }) res: Response,
) {
  const result = await this.authService.register(dto);
  this.setRefreshTokenCookie(res, result.refreshToken);
  return { accessToken: result.accessToken, user: result.user };
}

@Public()
@HttpCode(HttpStatus.OK)
@Post('refresh')
async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  const token = (req.cookies as Record<string, string>)?.[AUTH_COOKIE_NAME];
  if (!token) throw new UnauthorizedException('리프레시 토큰이 없습니다');
  const result = await this.authService.refreshTokens(token);
  this.setRefreshTokenCookie(res, result.refreshToken);
  return { accessToken: result.accessToken };
}

@Public()
@HttpCode(HttpStatus.OK)
@Throttle({ default: { limit: 3, ttl: 900000 } })
@Post('password-reset/request')
async requestReset(...) { ... }

private setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}
```

**Refresh token family pattern** (`apps/api/src/modules/auth/auth.service.ts` lines 148-199, 516-542):
```typescript
const tokenHash = createHash('sha256').update(oldRawToken).digest('hex');
const tokens = await this.db
  .select()
  .from(schema.refreshTokens)
  .where(eq(schema.refreshTokens.tokenHash, tokenHash));

if (tokenRecord.revokedAt) {
  await this.db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(schema.refreshTokens.family, tokenRecord.family));
  throw new UnauthorizedException('토큰이 재사용되었습니다. 보안을 위해 모든 세션이 종료됩니다.');
}

await this.db.insert(schema.refreshTokens).values({
  userId: tokenRecord.userId,
  tokenHash: newTokenHash,
  family: tokenRecord.family,
  expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
});

const rawToken = randomBytes(32).toString('hex');
const family = randomUUID();
await this.db.insert(schema.refreshTokens).values({ userId, tokenHash, family, expiresAt });
```

**Email service pattern** (`apps/api/src/modules/auth/email/email.service.ts` lines 26-72, 75-119):
```typescript
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isNonDev = nodeEnv !== 'development' && nodeEnv !== 'test';
    if (isNonDev && !apiKey) throw new Error('[email] RESEND_API_KEY is required...');
    this.resend = apiKey === undefined ? null : new Resend(apiKey);
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<SendEmailResult> {
    if (this.resend === null) {
      this.logger.log(`DEV EMAIL: password reset link for ${to}: ${resetLink}`);
      return { success: true };
    }
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: '[Grabit] 비밀번호 재설정',
      react: PasswordResetEmail({ resetLink }),
    });
    if (!error) return { success: true, id: data?.id };
    Sentry.captureException(new Error(`Resend send failed: ${error.message}`));
    return { success: false, error: error.message };
  }
}
```

**Email template pattern** (`apps/api/src/modules/auth/email/templates/password-reset.tsx` lines 13-43):
```tsx
export function PasswordResetEmail({ resetLink }: PasswordResetEmailProps) {
  return (
    <Html lang="ko">
      <Head />
      <Body style={{ backgroundColor: '#f5f5f7', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', maxWidth: '560px' }}>
          <Heading style={{ fontSize: '20px', color: '#1A1A2E' }}>비밀번호 재설정 안내</Heading>
          <Text style={{ fontSize: '14px', color: '#4A4A5E' }}>...</Text>
          <Button href={resetLink} style={{ backgroundColor: '#6C3CE0', color: '#ffffff' }}>
            비밀번호 재설정
          </Button>
        </Container>
      </Body>
    </Html>
  );
}
```

**Module wiring pattern** (`apps/api/src/modules/auth/auth.module.ts` lines 20-48):
```typescript
@Module({
  imports: [
    ConfigModule.forFeature(authConfig),
    PassportModule,
    UserModule,
    SmsModule,
    EmailModule,
    JwtModule.registerAsync({ imports: [ConfigModule.forFeature(authConfig)], inject: [ConfigService], useFactory: ... }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, KakaoStrategy, NaverStrategy, GoogleStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

**Planner notes:** email verification should use DB-backed opaque token hashes for latest-token-wins. Three-device cap must count distinct active `refresh_tokens.family`, not active token rows. Do not add LINE routes, guards, strategy, provider icon, or copy.

---

### SMS launch-country validation

**Apply to:** `apps/api/src/modules/sms/sms.controller.ts`, `sms.service.ts`, `phone.util.ts`, `apps/web/components/ui/phone-input.tsx`

**Analog:** existing SMS controller/service and PhoneInput

**Controller throttle + Zod pattern** (`apps/api/src/modules/sms/sms.controller.ts` lines 14-24, 33-67):
```typescript
export const sendCodeSchema = z.object({
  phone: z.string().regex(
    /^(01[016789]\d{7,8}|\+[1-9]\d{6,14})$/,
    '올바른 휴대폰 번호를 입력해주세요',
  ),
});

@Public()
@HttpCode(HttpStatus.OK)
@Throttle({ default: { limit: 20, ttl: 3_600_000 } })
@Post('send-code')
async sendCode(@Body(new ZodValidationPipe(sendCodeSchema)) dto: SendCodeBody) {
  return this.smsService.sendVerificationCode(dto.phone);
}
```

**E.164 parse, hashed Redis key, and rate-limit pattern** (`apps/api/src/modules/sms/sms.service.ts` lines 112-142, 219-258):
```typescript
const E164_RE = /^\+\d{6,15}$/;
function assertE164(s: string): void {
  if (!E164_RE.test(s)) {
    throw new Error(`[sms] non-E164 key input: ${s.slice(0, 4)}***`);
  }
}
export const smsResendKey = (e164: string): string => {
  assertE164(e164);
  return `{sms:${e164}}:resend`;
};

function parseE164OrBadRequest(phone: string): string {
  try {
    return parseE164(phone);
  } catch (err) {
    if (err instanceof Error && err.message === PHONE_VALIDATION_MESSAGE) {
      throw new BadRequestException(PHONE_VALIDATION_MESSAGE);
    }
    throw err;
  }
}

const e164 = parseE164OrBadRequest(phone);
const acquired = await this.redis.set(cooldownKey, '1', 'PX', RESEND_COOLDOWN_MS, 'NX');
if (acquired === null) {
  throw new HttpException(
    { statusCode: 429, message: '잠시 후 다시 시도해주세요', retryAfterMs: Math.max(ttl, 0) },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
```

**PhoneInput label/select pattern** (`apps/web/components/ui/phone-input.tsx` lines 39-53, 82-151):
```tsx
<PhoneInputPrimitive
  className={cn('flex', className)}
  labels={ko as Labels}
  defaultCountry="KR"
  flagComponent={FlagComponent}
  countrySelectComponent={CountrySelect}
  inputComponent={InputComponent}
  smartCaret={false}
  value={value || undefined}
  onChange={(v) => onChange(v ?? '')}
/>

<Popover>
  <PopoverTrigger asChild>
    <Button type="button" variant="outline" className="flex h-11 gap-1 rounded-s-lg rounded-e-none px-3">
      <FlagComponent country={value} countryName={(ko as Record<string, string>)[value] ?? value} />
      <ChevronsUpDown className="h-4 w-4 opacity-50" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-[300px] p-0">
    <Command>
      <CommandInput placeholder="국가 검색..." />
      <ScrollArea className="h-72">...</ScrollArea>
    </Command>
  </PopoverContent>
</Popover>
```

---

### Consent capture and admin audit query

**Apply to:** `apps/api/src/modules/consent/*`, `apps/api/src/database/schema/consent-*.ts`, `apps/web/app/admin/consent-audit/page.tsx`, `apps/web/components/admin/consent-audit-table.tsx`, `apps/web/components/auth/signup-step2.tsx`

**Analog:** existing terms agreement, user repository/controller, admin dashboard guard/query/table

**Existing consent limitation to replace additively** (`apps/api/src/database/schema/terms-agreements.ts` lines 4-13):
```typescript
export const termsAgreements = pgTable('terms_agreements', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  termsOfService: boolean('terms_of_service').notNull(),
  privacyPolicy: boolean('privacy_policy').notNull(),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  agreedAt: timestamp('agreed_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Repository CRUD pattern** (`apps/api/src/modules/user/user.repository.ts` lines 19-55, 64-71):
```typescript
@Injectable()
export class UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByEmail(email: string) {
    const results = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return results[0] ?? null;
  }

  async create(data: NewUser) {
    const results = await this.db.insert(schema.users).values({ ... }).returning();
    return results[0]!;
  }
}
```

**Admin-only controller pattern** (`apps/api/src/modules/admin/admin-dashboard.controller.ts` lines 1-24, 32-55):
```typescript
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { periodQuerySchema } from '@grabit/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

@Controller('admin/dashboard')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminDashboardController {
  constructor(@Inject(AdminDashboardService) private readonly service: AdminDashboardService) {}

  @Get('revenue')
  async getRevenue(
    @Query(new ZodValidationPipe(periodQuerySchema)) query: { period: DashboardPeriod },
  ) {
    return this.service.getRevenueTrend(query.period);
  }
}
```

**Admin query service pattern** (`apps/api/src/modules/admin/admin-dashboard.service.ts` lines 203-219, 225-255):
```typescript
const rows = await this.db
  .select({
    method: payments.method,
    count: sql<number>`count(*)::int`,
  })
  .from(payments)
  .innerJoin(reservations, eq(payments.reservationId, reservations.id))
  .where(and(
    eq(reservations.status, 'CONFIRMED'),
    eq(payments.status, 'DONE'),
    gte(reservations.createdAt, startUtc),
    lt(reservations.createdAt, endUtc),
  ))
  .groupBy(payments.method)
  .orderBy(sql`count(*) desc`);

const rows = await this.db
  .select({ performanceId: performances.id, title: performances.title })
  .from(reservations)
  .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
  .innerJoin(performances, eq(showtimes.performanceId, performances.id))
  .where(and(eq(reservations.status, 'CONFIRMED'), gte(reservations.createdAt, startUtc)))
  .limit(10);
```

**Signup consent UI pattern** (`apps/web/components/auth/signup-step2.tsx` lines 29-71, 93-190):
```tsx
const LEGAL_CONTENT = {
  termsOfService: { title: '이용약관', content: termsOfServiceMd },
  privacyPolicy: { title: '개인정보처리방침', content: privacyPolicyMd },
  marketingConsent: { title: '마케팅 수신 동의', content: marketingConsentMd },
} as const satisfies Record<string, { title: string; content: string }>;

const canProceed = termsOfService && privacyPolicy;

function handleSubmit() {
  if (!canProceed) return;
  onComplete({ termsOfService: true, privacyPolicy: true, marketingConsent });
}

<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
  <DialogContent className="max-h-[80vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>{LEGAL_CONTENT[dialogKey].title}</DialogTitle>
      <DialogDescription className="sr-only">...</DialogDescription>
    </DialogHeader>
    <TermsMarkdown>{LEGAL_CONTENT[dialogKey].content}</TermsMarkdown>
  </DialogContent>
</Dialog>
```

**Admin audit table pattern** (`apps/web/components/admin/admin-booking-table.tsx` lines 67-92, 121-160):
```tsx
<div className="rounded-lg bg-white shadow-sm">
  <Table>
    <TableHeader>
      <TableRow className="bg-[#F5F5F7]">
        <TableHead scope="col" className="text-sm font-semibold text-gray-600">예매번호</TableHead>
        <TableHead scope="col" className="text-sm font-semibold text-gray-600">예매자</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {bookings.map((booking) => (
        <TableRow
          key={booking.id}
          role="button"
          className="cursor-pointer hover:bg-gray-50"
          onClick={() => onRowClick(booking.id)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onRowClick(booking.id);
            }
          }}
        >
          <TableCell className="text-sm font-semibold">{booking.reservationNumber}</TableCell>
          <TableCell><Badge className={statusConfig.className}>{statusConfig.label}</Badge></TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
```

**Planner notes:** write immutable rows per consent item/version/language/user/IP/timestamp. Existing `terms_agreements` may remain for compatibility, but COMP-02 cannot be satisfied by booleans only. Mask email/phone/IP in web tables by default.

---

### Translation workflow and legal lock

**Apply to:** `apps/api/src/modules/translation/*`, `apps/api/src/database/schema/translation-*.ts`, `apps/web/app/admin/translations/page.tsx`, `apps/web/components/admin/translation-review-table.tsx`, legal content tables/pages

**Analog:** admin dashboard service/controller/table, legal markdown renderer, external client pattern

**Admin module wiring** (`apps/api/src/modules/admin/admin.module.ts` lines 16-33):
```typescript
@Module({
  imports: [PerformanceModule, PaymentModule, BookingModule],
  controllers: [
    AdminPerformanceController,
    AdminBannerController,
    AdminBookingController,
    LocalUploadController,
    AdminDashboardController,
    AdminDiagnosticsController,
  ],
  providers: [AdminService, AdminBookingService, UploadService, AdminDashboardService],
})
export class AdminModule {}
```

**Admin page state pattern** (`apps/web/app/admin/performances/page.tsx` lines 43-75, 96-105):
```tsx
const [status, setStatus] = useState('');
const [search, setSearch] = useState('');
const [debouncedSearch, setDebouncedSearch] = useState('');
const [page, setPage] = useState(1);

useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch(search);
    setPage(1);
  }, 300);
  return () => clearTimeout(timer);
}, [search]);

const { data, isLoading, isError } = useAdminPerformances({
  status: status || undefined,
  search: debouncedSearch || undefined,
  page,
});
```

**Admin hook pattern** (`apps/web/hooks/use-admin.ts` lines 15-32, 45-57):
```typescript
export function useAdminPerformances(params: { status?: string; search?: string; page?: number }) {
  return useQuery({
    queryKey: ['admin', 'performances', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params.status) searchParams.set('status', params.status);
      if (params.search) searchParams.set('search', params.search);
      searchParams.set('page', String(params.page ?? 1));
      return apiClient.get<PerformanceListResponse>(
        `/api/v1/admin/performances?${searchParams.toString()}`,
      );
    },
  });
}

export function useCreatePerformance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePerformanceInput) => apiClient.post('/api/v1/admin/performances', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'performances'] }),
  });
}
```

**Legal markdown render pattern** (`apps/web/components/legal/terms-markdown.tsx` lines 17-63, 77-88):
```tsx
const baseComponents: Components = {
  h2: ({ node: _node, ...props }) => (
    <h2 className="mt-6 text-base font-semibold text-gray-900 first:mt-0" {...props} />
  ),
  p: ({ node: _node, ...props }) => (
    <p className="mt-2 text-caption leading-relaxed text-gray-700" {...props} />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="mt-4 -mx-2 overflow-x-auto">
      <table className="min-w-full text-caption text-gray-700 border-collapse" {...props} />
    </div>
  ),
};

export function TermsMarkdown({ children, showH1 = false }: { children: string; showH1?: boolean }) {
  return (
    <ReactMarkdown components={buildComponents(showH1)} remarkPlugins={[remarkGfm]}>
      {children}
    </ReactMarkdown>
  );
}
```

**Legal page metadata/file pattern** (`apps/web/app/legal/terms/page.tsx` lines 1-26):
```tsx
import type { Metadata } from 'next';
import termsMd from '@/content/legal/terms-of-service.md?raw';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getLegalRobots } from '../robots';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: '이용약관 — Grabit',
  description: 'Grabit 서비스 이용 조건과 회원·회사의 권리·의무를 안내합니다.',
  alternates: { canonical: 'https://heygrabit.com/legal/terms' },
  robots: getLegalRobots(),
};

export default function TermsPage() {
  return <TermsMarkdown showH1>{termsMd}</TermsMarkdown>;
}
```

**Planner notes:** translation service must reject legal/notice/refund/booking-guide content before job enqueue. Public AI-assisted event/fanmeet content keeps automatic-translation label even after review. Legal Thai/Chinese fallback must show English canonical label, not machine translation.

---

### Next.js i18n routing, sitemap, locale switch/suggestion

**Apply to:** `apps/web/i18n/*`, `apps/web/messages/*.json`, `apps/web/proxy.ts`, `apps/web/app/layout.tsx`, `apps/web/app/sitemap.ts`, locale components

**Analog:** existing proxy/layout/legal metadata/PhoneInput/admin sidebar

**Proxy shape** (`apps/web/proxy.ts` lines 1-12):
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
```

**Root layout/provider pattern** (`apps/web/app/layout.tsx` lines 1-13, 15-31):
```tsx
import type { Metadata } from 'next';
import { pretendard } from './fonts';
import { Toaster } from '@/components/ui/sonner';
import { Providers } from './providers';
import { LayoutShell } from './layout-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grabit - 공연 티켓 예매',
  description: '공연, 전시, 스포츠 등 라이브 엔터테인먼트 티켓 예매 플랫폼',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <LayoutShell>{children}</LayoutShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
```

**Legal metadata canonical pattern for sitemap/hreflang thinking** (`apps/web/app/legal/privacy/page.tsx` lines 10-18):
```typescript
export const metadata: Metadata = {
  title: '개인정보처리방침 — Grabit',
  description: 'Grabit이 수집·이용하는 개인정보 항목과 처리 목적, 보유 기간 및 이용자의 권리를 안내합니다.',
  alternates: {
    canonical: 'https://heygrabit.com/legal/privacy',
  },
  robots: getLegalRobots(),
};
```

**Navigation active-item pattern** (`apps/web/components/admin/admin-sidebar.tsx` lines 8-29, 41-61):
```tsx
const NAV_ITEMS = [
  { label: '대시보드', href: '/admin', icon: LayoutDashboard },
  { label: '공연 관리', href: '/admin/performances', icon: Theater },
  { label: '예매 관리', href: '/admin/bookings', icon: Ticket },
] as const;

<nav className="flex flex-col gap-1 p-4" aria-label="관리자 네비게이션">
  {NAV_ITEMS.map((item) => {
    const isActive = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link className={cn(isActive ? 'border-l-[3px] border-primary bg-primary/5 text-primary' : 'text-gray-600')}>
        <Icon className="h-5 w-5" />
        {item.label}
      </Link>
    );
  })}
</nav>
```

**Planner notes:** use `next-intl` `localePrefix: 'as-needed'`; URL locale should win for current request, then explicit switch action/profile/cookie/default. Accept-Language and GeoIP may only produce a one-time suggestion, never redirect `/` away from Korean.

---

### Web booking disabled UI

**Apply to:** `apps/web/components/booking/booking-page.tsx`, `apps/web/hooks/use-booking.ts`, event/detail booking CTA surfaces

**Analog:** existing booking page and hooks

**Optimistic lock call to block when disabled** (`apps/web/components/booking/booking-page.tsx` lines 183-255):
```tsx
const handleSeatClick = useCallback((seatId: string) => {
  if (!selectedShowtimeId) return;

  const seatState = seatStatesMap.get(seatId);
  if (seatState === 'locked' && !selectedSeatIds.has(seatId)) {
    toast.info('이미 다른 사용자가 선택한 좌석입니다');
    return;
  }

  addSeat(seatSelection);
  lockSeat.mutate(
    { showtimeId: selectedShowtimeId, seatId },
    {
      onSuccess: (response) => {
        if (response.expiresAt) setTimerExpiry(response.expiresAt);
      },
      onError: (error: unknown) => {
        removeSeat(seatId);
        if (error instanceof ApiClientError && error.statusCode === 409) {
          toast.info('이미 다른 사용자가 선택한 좌석입니다');
        } else {
          toast.error('일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        }
      },
    },
  );
}, [...]);
```

**Hook endpoints to keep gated** (`apps/web/hooks/use-booking.ts` lines 49-59, 103-118):
```typescript
export function useLockSeat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: LockSeatRequest) =>
      apiClient.post<LockSeatResponse>('/api/v1/booking/seats/lock', data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['seat-status', variables.showtimeId] });
    },
  });
}

export function usePrepareReservation() {
  return useMutation({
    mutationFn: (data: PrepareReservationRequest) =>
      apiClient.post<PrepareReservationResponse>('/api/v1/reservations/prepare', data, {
        showErrorToast: false,
      }),
  });
}
```

---

### Drizzle expand-only schema and migration

**Apply to:** all `apps/api/src/database/schema/*.ts` changes and `apps/api/src/database/migrations/0007_phase23_launch_foundation.sql`

**Analog:** existing Drizzle schema/index/migrations

**Schema table/index pattern** (`apps/api/src/database/schema/refresh-tokens.ts` lines 1-18):
```typescript
import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  family: varchar('family', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('idx_refresh_tokens_token_hash').on(table.tokenHash),
  index('idx_refresh_tokens_family').on(table.family),
  index('idx_refresh_tokens_user_id').on(table.userId),
]);
```

**Enum/index pattern** (`apps/api/src/database/schema/performances.ts` lines 1-35):
```typescript
import { pgTable, uuid, varchar, text, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const performanceStatusEnum = pgEnum('performance_status', [
  'upcoming', 'selling', 'closing_soon', 'ended',
]);

export const performances = pgTable('performances', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  status: performanceStatusEnum('status').notNull().default('upcoming'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_performances_status').on(table.status),
  index('idx_performances_title_trgm').using('gin', sql`${table.title} gin_trgm_ops`),
]);
```

**Schema barrel pattern** (`apps/api/src/database/schema/index.ts` lines 1-15):
```typescript
export { users, genderEnum } from './users.js';
export { socialAccounts } from './social-accounts.js';
export { refreshTokens } from './refresh-tokens.js';
export { termsAgreements } from './terms-agreements.js';
export { performances, genreEnum as performanceGenreEnum, performanceStatusEnum } from './performances.js';
export { payments, paymentStatusEnum } from './payments.js';
```

**Migration format** (`apps/api/src/database/migrations/0000_deep_bloodaxe.sql` lines 1-29; `0005_unknown_blob.sql` lines 1-3):
```sql
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'unspecified');--> statement-breakpoint
CREATE TABLE "terms_agreements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "terms_of_service" boolean NOT NULL,
  "privacy_policy" boolean NOT NULL,
  "marketing_consent" boolean DEFAULT false NOT NULL,
  "agreed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_token_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" USING btree ("family");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" USING btree ("user_id");
```

**Planner notes:** Phase 23 migration must be expand-only. Add nullable/defaulted columns and new tables/indexes first. Avoid drop/rename/contract changes like `0006_luxuriant_tony_stark.sql` lines 1-2 unless explicitly justified outside launch foundation.

## Shared Patterns

### Validation
**Source:** `apps/api/src/common/pipes/zod-validation.pipe.ts` lines 8-30  
**Apply to:** all new controllers receiving body/query params.
```typescript
const result = this.schema.safeParse(value);
if (!result.success) {
  const zodError = result.error as ZodError;
  throw new BadRequestException({
    message: 'Validation failed',
    errors: zodError.flatten().fieldErrors,
  });
}
return result.data;
```

### Admin Authorization
**Source:** `apps/api/src/modules/admin/admin-dashboard.controller.ts` lines 18-20 and `apps/api/src/common/guards/roles.guard.ts` lines 9-20  
**Apply to:** translation admin and consent audit APIs.
```typescript
@Controller('admin/dashboard')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminDashboardController {}

const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
  context.getHandler(),
  context.getClass(),
]);
const { user } = context.switchToHttp().getRequest() as { user: { role: string } };
return requiredRoles.includes(user.role);
```

### Error Response Formatting
**Source:** `apps/api/src/common/filters/http-exception.filter.ts` lines 18-31 and `toss-payment-exception.filter.ts` lines 21-41  
**Apply to:** feature flag, consent, translation, email verification service errors.
```typescript
if (status >= 500) {
  Sentry.captureException(exception);
}

response.status(status).json({
  statusCode: status,
  message: exception.message,
  errors,
  timestamp: new Date().toISOString(),
});

response.status(statusCode).json({
  statusCode,
  code: exception.code,
  message: exception.message,
  timestamp: new Date().toISOString(),
});
```

### React Query + API Client
**Source:** `apps/web/lib/api-client.ts` lines 61-139 and `apps/web/hooks/use-admin-dashboard.ts` lines 17-72  
**Apply to:** feature flag runtime fetch, translation queue, consent audit query.
```typescript
async function request<T>(method: string, path: ApiPath, body?: unknown, options: ApiClientOptions = {}): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  let res = await fetch(apiUrl(path), { method, headers, credentials: 'include', body: JSON.stringify(body) });
  if (!res.ok) throw new ApiClientError(errorMessage, status);
  return res.json() as Promise<T>;
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['admin', 'dashboard', 'summary'],
    queryFn: () => apiClient.get<DashboardSummaryDto>('/api/v1/admin/dashboard/summary'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
```

### Admin Table UX
**Source:** `apps/web/components/admin/admin-booking-table.tsx` lines 95-118, 121-160  
**Apply to:** translation review and consent audit tables.
```tsx
{isLoading && Array.from({ length: 5 }).map((_, i) => (
  <TableRow key={`skeleton-${i}`}>
    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
  </TableRow>
))}

{!isLoading && bookings.length === 0 && (
  <TableRow>
    <TableCell colSpan={7} className="py-12 text-center">
      <p className="text-base font-semibold text-gray-900">예매 내역이 없습니다</p>
      <p className="mt-1 text-sm text-gray-600">아직 예매가 접수되지 않았습니다</p>
    </TableCell>
  </TableRow>
)}
```

### Legal Content Lock
**Source:** `apps/web/content/legal/__tests__/legal-content.test.ts` lines 13-28, 30-61  
**Apply to:** new `ko`/`en` legal markdown/content lock tests.
```typescript
const placeholderPatterns = [
  /\[사업자명:/,
  /\[대표자명:/,
  /000-00-00000/,
  /YYYY-MM-DD/,
];

it.each(Object.entries(legalDocuments))(
  '%s does not expose launch placeholder values',
  (_filename, content) => {
    for (const pattern of placeholderPatterns) {
      expect(content).not.toMatch(pattern);
    }
  },
);
```

## No Analog Found

No Phase 23 file lacks a usable local analog. The weakest matches are `next-intl` routing files and DeepL translation adapter because the repo does not yet use those libraries. For those, planner should combine:

| File | Role | Data Flow | Local Analog | External Pattern Needed |
|---|---|---|---|---|
| `apps/web/i18n/routing.ts` | config | request-response | `apps/web/proxy.ts` | `next-intl defineRouting`, `localePrefix: 'as-needed'` |
| `apps/web/i18n/request.ts` | config | request-response | `apps/web/app/layout.tsx` | `next-intl getRequestConfig` |
| `apps/api/src/modules/translation/deepl.client.ts` | service | request-response | `TossPaymentsClient` | `deepl-node Translator.translateText` |
| `apps/web/app/sitemap.ts` | route | transform | legal `metadata.alternates` pages | Next.js `MetadataRoute.Sitemap` alternates |

## Metadata

**Analog search scope:** `packages/shared/src`, `apps/api/src`, `apps/web/app`, `apps/web/components`, `apps/web/hooks`, `apps/web/lib`, `apps/api/src/database/migrations`  
**Files scanned:** repo file list plus targeted `rg` for auth, throttle, booking, reservation, payment, admin guards, legal markdown, table, metadata, and i18n markers  
**Pattern extraction date:** 2026-05-06 KST  
**Project skill directories:** none found at repo-local `.codex/skills` or `.agents/skills`  
**Scope warnings:** LINE login is stale in roadmap/requirements and excluded by Phase 23 context; do not implement LINE.
