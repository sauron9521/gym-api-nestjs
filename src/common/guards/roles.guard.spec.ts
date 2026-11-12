import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '#prisma/client';

import { ROLES_KEY, Roles } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

@Roles(Role.TRAINER)
class TrainerController {
  @Roles(Role.ATHLETE)
  athleteOnly() {}

  trainerOnly() {}

  @Roles()
  publiclyOverridden() {}

  @Roles(Role.TRAINER, Role.ADMIN)
  trainerOrAdmin() {}
}

class PublicController {
  noMetadata() {}
}

// Reflect.get returns the original handler without triggering unbound-method
// lint warnings; binding a method would lose its decorator metadata.
const trainerHandler = (key: keyof TrainerController): () => void =>
  Reflect.get(TrainerController.prototype, key) as () => void;
const publicHandler = (): () => void =>
  Reflect.get(PublicController.prototype, 'noMetadata') as () => void;

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  function makeContext(
    handler: (...args: never[]) => unknown,
    controller: new (...args: never[]) => unknown,
    user?: { id: string; role: Role },
  ) {
    const getRequest = vi.fn().mockReturnValue({ user });
    const switchToHttp = vi.fn().mockReturnValue({ getRequest });
    const context = {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp,
    } as unknown as ExecutionContext;

    return { context, getRequest, switchToHttp };
  }

  it('shares a stable roles metadata key between decorator and guard', () => {
    expect(ROLES_KEY).toBe('roles');
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, TrainerController)).toEqual([
      Role.TRAINER,
    ]);
    expect(reflector.get<Role[]>(
      ROLES_KEY,
      trainerHandler('athleteOnly'),
    )).toEqual([Role.ATHLETE]);
    expect(reflector.get<Role[]>(
      ROLES_KEY,
      trainerHandler('publiclyOverridden'),
    )).toEqual([]);
  });

  it('allows endpoints without role metadata without touching the request', () => {
    const { context, switchToHttp } = makeContext(
      publicHandler(),
      PublicController,
    );
    expect(guard.canActivate(context)).toBe(true);
    expect(switchToHttp).not.toHaveBeenCalled();
  });

  it('enforces class-level roles on methods without an override', () => {
    const { context } = makeContext(
      trainerHandler('trainerOnly'),
      TrainerController,
      { id: 'trainer-1', role: Role.TRAINER },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([
    { description: 'no authenticated principal', user: undefined },
    { description: 'athlete instead of trainer', user: { id: 'athlete-1', role: Role.ATHLETE } },
    { description: 'admin instead of trainer', user: { id: 'admin-1', role: Role.ADMIN } },
  ])('rejects $description on a trainer-only route', ({ user }) => {
    const { context, getRequest } = makeContext(
      trainerHandler('trainerOnly'),
      TrainerController,
      user,
    );
    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Insufficient permissions'),
    );
    expect(getRequest).toHaveBeenCalledOnce();
  });

  it('prefers method metadata over the controller role for athletes', () => {
    const { context } = makeContext(
      trainerHandler('athleteOnly'),
      TrainerController,
      { id: 'athlete-1', role: Role.ATHLETE },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('does not fall back to the class-level trainer role if a method requires an athlete', () => {
    const { context } = makeContext(
      trainerHandler('athleteOnly'),
      TrainerController,
      { id: 'trainer-1', role: Role.TRAINER },
    );
    expect(() => guard.canActivate(context))
      .toThrow(ForbiddenException);
  });

  it('honors an explicitly empty method-level roles override', () => {
    const { context, switchToHttp } = makeContext(
      trainerHandler('publiclyOverridden'),
      TrainerController,
    );
    expect(guard.canActivate(context)).toBe(true);
    expect(switchToHttp).not.toHaveBeenCalled();
  });

  it.each([Role.TRAINER, Role.ADMIN])('allows a listed role %s', (role) => {
    const { context } = makeContext(
      trainerHandler('trainerOrAdmin'),
      TrainerController,
      { id: 'actor-1', role },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a principal outside the declared multi-role policy', () => {
    const { context } = makeContext(
      trainerHandler('trainerOrAdmin'),
      TrainerController,
      { id: 'athlete-1', role: Role.ATHLETE },
    );
    expect(() => guard.canActivate(context))
      .toThrow(ForbiddenException);
  });
});
