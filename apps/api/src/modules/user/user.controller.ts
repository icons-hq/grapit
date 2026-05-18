import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { UserService } from './user.service.js';
import {
  accountWithdrawalSchema,
  updateProfileSchema,
  type AccountWithdrawalInput,
  type UpdateProfileInput,
} from '@grabit/shared/schemas/user.schema.js';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: RequestUser) {
    return this.userService.getUserProfile(user.id);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileInput,
  ) {
    return this.userService.updateProfile(user.id, dto);
  }

  @Post('me/withdrawal')
  async withdrawSelf(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(accountWithdrawalSchema)) dto: AccountWithdrawalInput,
    @Req() request: Request,
  ) {
    return this.userService.withdrawSelf(user.id, dto, requestContext(request));
  }
}

function requestContext(request: Request) {
  return {
    ipAddress: resolveTrustedRequestIp(request),
    userAgent: request.get('user-agent') ?? null,
    requestId: request.get('x-request-id') ?? null,
  };
}
