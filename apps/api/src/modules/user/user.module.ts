import { Module } from '@nestjs/common';
import { UserService } from './user.service.js';
import { UserRepository } from './user.repository.js';
import { UserController } from './user.controller.js';
import { SmsModule } from '../sms/sms.module.js';

@Module({
  imports: [SmsModule],
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService, UserRepository],
})
export class UserModule {}
