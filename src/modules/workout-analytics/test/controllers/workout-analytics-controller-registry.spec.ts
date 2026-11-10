import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { WorkoutAnalyticsController } from '../../controllers/workout-analytics.controller.js';
import { WorkoutAnalyticsModule } from '../../workout-analytics.module.js';

describe('WorkoutAnalyticsModule controller registry', () => {
  it('registers only the analytics controller under the original route prefix', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      WorkoutAnalyticsModule,
    );

    expect(controllers).toEqual([WorkoutAnalyticsController]);
    expect(Reflect.getMetadata(PATH_METADATA, WorkoutAnalyticsController))
      .toBe('workout-analytics');
  });

  it.each([
    ['summary', RequestMethod.GET, 'summary'],
    ['exercise', RequestMethod.GET, 'exercises/:exerciseId'],
  ] as const)('preserves the %s HTTP method and path', (name, method, path) => {
    const handler = WorkoutAnalyticsController.prototype[name];

    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBeUndefined();
  });

  it('keeps the 20-per-minute throttling on both analytics endpoints', () => {
    const handlers = WorkoutAnalyticsController.prototype;
    for (const handler of [handlers.summary, handlers.exercise]) {
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(20);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    }
  });

  it('registers exactly two unique HTTP method/path pairs', () => {
    const routes = Object.getOwnPropertyNames(WorkoutAnalyticsController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = Object.getOwnPropertyDescriptor(
          WorkoutAnalyticsController.prototype,
          name,
        )?.value as (...args: unknown[]) => unknown;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        return `${method}:workout-analytics/${path}`;
      });

    expect(routes).toHaveLength(2);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
