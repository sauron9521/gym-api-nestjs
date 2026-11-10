import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { BodyMeasurementsController } from '../../controllers/body-measurements.controller.js';
import { BodyMeasurementsModule } from '../../body-measurements.module.js';

describe('BodyMeasurementsModule controller registry', () => {
  const handlers = BodyMeasurementsController.prototype;

  it('registers one controller under the original route prefix', () => {
    const registered: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      BodyMeasurementsModule,
    );
    expect(registered).toEqual([BodyMeasurementsController]);
    expect(Reflect.getMetadata(PATH_METADATA, BodyMeasurementsController))
      .toBe('body-measurements');
  });

  it.each([
    ['create', RequestMethod.POST, '/'],
    ['findMany', RequestMethod.GET, '/'],
    ['statistics', RequestMethod.GET, 'statistics'],
    ['findOne', RequestMethod.GET, ':id'],
    ['update', RequestMethod.PATCH, ':id'],
    ['remove', RequestMethod.DELETE, ':id'],
  ] as const)('preserves %s method and route', (name, method, path) => {
    const handler = handlers[name];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  });

  it('registers the static statistics handler before dynamic :id route', () => {
    const names = Object.getOwnPropertyNames(handlers);
    expect(names.indexOf('statistics')).toBeGreaterThan(-1);
    expect(names.indexOf('statistics')).toBeLessThan(names.indexOf('findOne'));
  });

  it('preserves explicit 204 No Content for deletion and default 201 for creation', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handlers.remove)).toBe(204);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handlers.create)).toBeUndefined();
  });

  it('declares exactly six distinct HTTP verb/path pairs', () => {
    const routes = Object.getOwnPropertyNames(handlers)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = Object.getOwnPropertyDescriptor(handlers, name)
          ?.value as (...args: unknown[]) => unknown;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        expect(method, `Missing HTTP method on ${name}`).toBeDefined();
        expect(path, `Missing HTTP path on ${name}`).toBeDefined();
        return `${method}:body-measurements/${path}`;
      });
    expect(routes).toHaveLength(6);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
