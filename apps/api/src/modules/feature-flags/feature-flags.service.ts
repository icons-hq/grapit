import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { readFeatureFlags } from '@grabit/shared';
import {
  canUseAdminBookingBypass,
  type AdminBookingBypassActor,
} from '../../common/admin-booking-bypass.js';

type RuntimeEnv = Record<string, string | undefined>;
type RuntimeEnvProvider = () => RuntimeEnv;
type BookingActor = AdminBookingBypassActor & { id: string };

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
    if (this.getFlags().bookingEnabled || canUseAdminBookingBypass(actor)) {
      return;
    }

    throw new ForbiddenException('예매는 추후 오픈 예정입니다');
  }
}
