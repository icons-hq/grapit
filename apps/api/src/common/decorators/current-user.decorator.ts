import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type {
  AdminCapability,
  AdminCapabilityBundle,
} from '@grabit/shared/types/admin-operations.types.js';

export interface RequestUser {
  id: string;
  email: string;
  role: string;
  adminCapabilityBundle?: AdminCapabilityBundle | null;
  adminCapabilities?: AdminCapability[];
}

export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
    const user = request.user;

    if (data) {
      return user[data];
    }
    return user;
  },
);
