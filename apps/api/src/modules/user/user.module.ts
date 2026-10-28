import { Module } from '@nestjs/common';
import { UserService } from './user.service.js';
import { UserRepository } from './user.repository.js';
import { UserController } from './user.controller.js';
import { SmsModule } from '../sms/sms.module.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { FavoritesService } from './favorites.service.js';
import { FavoritesController } from './favorites.controller.js';

@Module({
  imports: [SmsModule],
  controllers: [UserController, FavoritesController],
  providers: [UserService, UserRepository, AdminAuditService, FavoritesService],
  exports: [UserService, UserRepository],
})
export class UserModule {}
