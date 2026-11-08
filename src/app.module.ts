import { join } from 'node:path';
import { validateEnv } from './config/env.validation.js';
import { createMailOptions } from './config/mail.config.js';
import type { AppEnv } from './config/env.schema.js';
import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import type { NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware.js';
import { HealthModule } from './health/health.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthenticationModule } from '@nestjs/authentication';
import {
  MailModule,
} from '@nestjs/mail';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ExercisesModule } from './modules/exercises/exercises.module.js';
import { WorkoutsModule } from './modules/workouts/workouts.module.js';
import { BodyMeasurementsModule } from './modules/body-measurements/body-measurements.module.js';
import { PrismaModule } from './database/index.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { TrainerAthletesModule } from './modules/trainer-athletes/trainer-athletes.module.js';
import { TrainingProgramsModule } from './modules/training-programs/training-programs.module.js';

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
      validate: validateEnv,
    }),
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createMailOptions(
          {
            NODE_ENV: config.getOrThrow<AppEnv['NODE_ENV']>('NODE_ENV'),
            SMTP_URL: config.get<AppEnv['SMTP_URL']>('SMTP_URL'),
            MAIL_FROM: config.get<AppEnv['MAIL_FROM']>('MAIL_FROM'),
          },
          join(import.meta.dirname, 'mail/templates'),
        ),
    }),
    PrismaModule,
    HealthModule,
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
    ExercisesModule,
    WorkoutsModule,
    BodyMeasurementsModule,
    TrainerAthletesModule,
    TrainingProgramsModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    {
      provide: APP_GUARD,
      useExisting: ThrottlerGuard,
    },
    ThrottlerGuard,
    {
      provide: APP_GUARD,
      useExisting: RolesGuard,
    },
    RolesGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5/path-to-regexp named wildcard, including the root route.
    consumer.apply(RequestContextMiddleware).forRoutes({
      path: '{*splat}',
      method: RequestMethod.ALL,
    });
  }
}
