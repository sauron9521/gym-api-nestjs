import { Module } from '@nestjs/common';
import {PrismaModule} from './prisma/index.js';



@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
