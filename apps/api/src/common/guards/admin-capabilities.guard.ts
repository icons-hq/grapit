import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  resolveAdminCapabilitySnapshot,
  type AdminCapability,
  type AdminCapabilityUser,
} from '@grabit/shared';
import { ADMIN_CAPABILITIES_KEY, ADMIN_ANY_CAPABILITIES_KEY } from '../decorators/admin-capabilities.decorator.js';

@Injectable()
export class AdminCapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredCapabilities = this.reflector.getAllAndOverride<AdminCapability[]>(
      ADMIN_CAPABILITIES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const anyCapabilities = this.reflector.getAllAndOverride<AdminCapability[]>(
      ADMIN_ANY_CAPABILITIES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredCapabilities?.length && !anyCapabilities?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AdminCapabilityUser;
    }>();

    if (!request.user) {
      return false;
    }

    const snapshot = resolveAdminCapabilitySnapshot(request.user);
    if (snapshot.superuser) {
      return true;
    }

    const hasAll = (requiredCapabilities ?? []).every((capability) =>
      snapshot.capabilities.includes(capability),
    );
    const hasAny = !anyCapabilities?.length || anyCapabilities.some((capability) =>
      snapshot.capabilities.includes(capability),
    );
    return hasAll && hasAny;
  }
}
