import { Controller, Get } from '@nestjs/common';

@Controller('/')
export class UsersController {
  @Get()
  getHalloWorld() {
    return 'Hello World!';
  }
}
