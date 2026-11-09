import { join } from 'node:path';

import { AuthenticationModule } from '@nestjs/authentication';
import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import type { NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MailModule } from '@nestjs/mail';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ApiExceptionFilter } from '#src/common/filters/api-exception.filter';
import { RolesGuard } from '#src/common/guards/roles.guard';
import { RequestContextMiddleware } from '#src/common/request-context/request-context.middleware';
import { AuthNoStoreMiddleware } from '#src/modules/auth/middleware/auth-no-store.middleware';
import { PrivateApiNoStoreMiddleware } from '#src/common/http/private-api-no-store.middleware';
import type { AppConfigService } from '#src/common/config/app-config.types';
import { validateEnv } from '#src/common/config/env.validation';
import { createMailOptions } from '#src/common/config/mail.config';
import { PrismaModule } from '#src/infra/database/index';
import { HealthModule } from '#src/infra/health/health.module';
import { AuthModule } from '#src/modules/auth/auth.module';
import { BodyMeasurementsModule } from '#src/modules/body-measurements/body-measurements.module';
import { ExercisesModule } from '#src/modules/exercises/exercises.module';
import { TrainerAthletesModule } from '#src/modules/trainer-athletes/trainer-athletes.module';
import { TrainingProgramsModule } from '#src/modules/training-programs/training-programs.module';
import { UsersModule } from '#src/modules/users/users.module';
import { WorkoutsModule } from '#src/modules/workouts/workouts.module';

@Module({
  imports: [
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => ({
        accessToken: {
          key: config.getOrThrow('JWT_SECRET'),
          issuer: config.getOrThrow('JWT_ISSUER'),
          audience: 'mobile-app',
          ttl: '15m',
        },
        session: { absoluteTtl: '7d', idleTtl: '1d' },
        emailVerification: {
          url: `${config.getOrThrow('APP_URL')}/verify-email`,
        },
        passwordReset: {
          url: `${config.getOrThrow('APP_URL')}/reset-password`,
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
      useFactory: (config: AppConfigService) =>
        createMailOptions(
          {
            NODE_ENV: config.getOrThrow('NODE_ENV'),
            SMTP_URL: config.get('SMTP_URL'),
            MAIL_FROM: config.get('MAIL_FROM'),
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
    consumer
      .apply(
        RequestContextMiddleware,
        AuthNoStoreMiddleware,
        PrivateApiNoStoreMiddleware,
      )
      .forRoutes({
      path: '{*splat}',
      method: RequestMethod.ALL,
    });
  }
}
