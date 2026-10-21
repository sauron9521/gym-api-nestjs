import { AuthenticationModule } from '@nestjs/authentication';
import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/index.js';
import { PrismaModule } from './prisma/index.js';

@Module({
  imports: [
    AuthenticationModule.forRoot({
      session: { absoluteTtl: '15m', idleTtl: '30d' },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
