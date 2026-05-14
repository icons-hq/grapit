import { SetMetadata } from '@nestjs/common';
import type { AdminCapability } from '@grabit/shared';

export const ADMIN_CAPABILITIES_KEY = 'admin_capabilities';

export const AdminCapabilities = (...capabilities: AdminCapability[]) =>
  SetMetadata(ADMIN_CAPABILITIES_KEY, capabilities);
