import { Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator.js';
import { FavoritesService } from './favorites.service.js';

@Controller('users/me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}
  @Get()
  list(@CurrentUser() user: RequestUser) { return this.favorites.list(user.id); }
  @Put(':performanceId')
  add(@CurrentUser() user: RequestUser, @Param('performanceId', new ParseUUIDPipe()) id: string) {
    return this.favorites.add(user.id, id.toLowerCase());
  }
  @Delete(':performanceId')
  remove(@CurrentUser() user: RequestUser, @Param('performanceId', new ParseUUIDPipe()) id: string) {
    return this.favorites.remove(user.id, id.toLowerCase());
  }
}
