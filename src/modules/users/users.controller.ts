import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Authenticate, CurrentUser } from '@nestjs/authentication';

import { UsersService } from './users.service.js';
import {
  type UpdateMyProfileDto,
  updateMyProfileSchema,
} from './dto/update-my-profile.dto.js';

type UserActor = { id: string };

@Controller('users')
@Authenticate()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: UserActor) {
    return this.usersService.findMe(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: UserActor,
    @Body({ schema: updateMyProfileSchema })
    body: UpdateMyProfileDto,
  ) {
    return this.usersService.updateMe(user.id, body);
  }
}
