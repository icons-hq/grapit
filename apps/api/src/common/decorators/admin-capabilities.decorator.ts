import { SetMetadata } from '@nestjs/common';
import type { AdminCapability } from '@grabit/shared';

export const ADMIN_CAPABILITIES_KEY = 'admin_capabilities';
export const ADMIN_ANY_CAPABILITIES_KEY = 'admin_any_capabilities';

export const AdminCapabilities = (...capabilities: AdminCapability[]) =>
  SetMetadata(ADMIN_CAPABILITIES_KEY, capabilities);

export const AdminAnyCapabilities = (...capabilities: AdminCapability[]) =>
  SetMetadata(ADMIN_ANY_CAPABILITIES_KEY, capabilities);
