import { Module } from '@nestjs/common';
import {
  FEATURE_FLAGS_ENV_PROVIDER,
  FeatureFlagsService,
} from './feature-flags.service.js';

@Module({
  providers: [
    {
      provide: FEATURE_FLAGS_ENV_PROVIDER,
      useValue: () => process.env,
    },
    FeatureFlagsService,
  ],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
