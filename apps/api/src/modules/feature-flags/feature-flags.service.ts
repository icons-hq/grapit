import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { readFeatureFlags } from '@grabit/shared';

type RuntimeEnv = Record<string, string | undefined>;
type RuntimeEnvProvider = () => RuntimeEnv;
type BookingActor = { id: string; role?: string };

export const FEATURE_FLAGS_ENV_PROVIDER = Symbol('FEATURE_FLAGS_ENV_PROVIDER');

@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(FEATURE_FLAGS_ENV_PROVIDER)
    private readonly runtimeEnvProvider: RuntimeEnvProvider,
  ) {}

  getFlags(): ReturnType<typeof readFeatureFlags> {
    return readFeatureFlags(this.runtimeEnvProvider());
  }

  assertBookingEnabled(actor?: BookingActor): void {
    if (this.getFlags().bookingEnabled || actor?.role === 'admin') {
      return;
    }

    throw new ForbiddenException('예매는 추후 오픈 예정입니다');
  }
}
