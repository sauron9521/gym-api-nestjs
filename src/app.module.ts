import { AuthenticationModule } from '@nestjs/authentication';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  FileTemplateEngine,
  LogMailTransport,
  MailModule,
  SmtpTransport,
} from '@nestjs/mail';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/index.js';
import { PrismaModule } from './prisma/index.js';
import { join } from 'node:path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        session: { absoluteTtl: '7d', idleTtl: '1d' },
        emailVerification: {
          url: `${config.getOrThrow<string>('APP_URL')}/verify-email`,
        },
        passwordReset: {
          url: `${config.getOrThrow<string>('APP_URL')}/reset-password`,
        },
      }),
    }),
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: process.env.SMTP_URL
          ? new SmtpTransport({
              url: config.getOrThrow<string>('APP_URL'),
            })
          : new LogMailTransport(),
        templates: new FileTemplateEngine({
          dir: join(import.meta.dirname, 'mail/templates'),
        }),
        from: 'Fitness_gym APP <trol95213@gmail.com>',
      }),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [],
  providers: [ConfigService],
})
export class AppModule {}
