import { Controller, Get } from '@nestjs/common';

/** Legacy root route retained for backward-compatible auth smoke tests. */
@Controller('/')
export class RootController {
  @Get()
  getHelloWorld() {
    return 'Hello World!';
  }
}
