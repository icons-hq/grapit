import { ForbiddenException, Injectable } from '@nestjs/common';
import { readFeatureFlags } from '@grabit/shared';

type RuntimeEnv = Record<string, string | undefined>;

@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly runtimeEnvProvider: () => RuntimeEnv = () => process.env,
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
