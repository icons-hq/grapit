import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { readFeatureFlags } from '@grabit/shared';

type RuntimeEnv = Record<string, string | undefined>;
type RuntimeEnvProvider = () => RuntimeEnv;

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

  assertBookingEnabled(message = '예매는 5월말 오픈 예정입니다'): void {
    if (!this.getFlags().bookingEnabled) {
      throw new ForbiddenException(message);
    }
  }
}
