import { AuthenticationModule } from '@nestjs/authentication';
import { Module } from '@nestjs/common';
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
    AuthenticationModule.forRootAsync({
      useFactory: () => ({
        session: { absoluteTtl: '7d', idleTtl: '1d' },
        emailVerification: { url: `${process.env.APP_URL}/verify-email` },
        passwordReset: { url: `${process.env.APP_URL}/reset-password` },
      }),
    }),
    MailModule.forRootAsync({
      useFactory: () => ({
        transport: process.env.SMTP_URL
          ? new SmtpTransport({ url: process.env.SMTP_URL })
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
  providers: [],
})
export class AppModule {}
