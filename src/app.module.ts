import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthenticationModule } from '@nestjs/authentication';
import {
  FileTemplateEngine,
  LogMailTransport,
  MailModule,
  SmtpTransport,
} from '@nestjs/mail';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module.js';

import { PrismaModule } from './database/index.js';
import { ScheduleModule } from '@nestjs/schedule';
import { RolesGuard } from './common/guards/roles.guard.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        accessToken: {
          key: config.getOrThrow<string>('JWT_SECRET'),
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: 'mobile-app',
          ttl: '15m',
        },
        session: { absoluteTtl: '7d', idleTtl: '1d' },
        emailVerification: {
          url: `${config.getOrThrow<string>('APP_URL')}/verify-email`,
        },
        passwordReset: {
          url: `${config.getOrThrow<string>('APP_URL')}/reset-password`,
        },
      }),
    }),
    AuthModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: config.get<string>('SMTP_URL')
          ? new SmtpTransport({
              url: config.get<string>('SMTP_URL'),
            })
          : new LogMailTransport(),
        templates: new FileTemplateEngine({
          dir: join(import.meta.dirname, 'mail/templates'),
        }),
        from: 'Fitness_gym APP <trol95213@gmail.com>',
      }),
    }),
    PrismaModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 10,
        },
      ],
    }),
    ScheduleModule.forRoot(),
    UsersModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
