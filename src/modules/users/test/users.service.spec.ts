import { NotFoundException } from '@nestjs/common';

import { UsersRepository } from '../users.repository.js';
import { UsersService } from '../users.service.js';

describe('UsersService', () => {
  const repository = {
    findMe: vi.fn(),
    upsertMyProfile: vi.fn(),
  };
  let service: UsersService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new UsersService(repository as unknown as UsersRepository);
  });

  it('returns a user without a profile as profile: null', async () => {
    repository.findMe.mockResolvedValue({
      id: 'user-1',
      email: 'athlete@example.com',
      role: 'ATHLETE',
      profile: null,
    });

    await expect(service.findMe('user-1')).resolves.toMatchObject({
      id: 'user-1',
      profile: null,
    });
    expect(repository.findMe).toHaveBeenCalledWith('user-1');
  });

  it('formats birthday as a date-only string', async () => {
    repository.findMe.mockResolvedValue({
      id: 'user-1',
      email: 'athlete@example.com',
      profile: {
        name: 'Athlete',
        birthday: new Date('1998-03-04T00:00:00.000Z'),
        height: 193,
        weight: { toString: () => '81.25' },
      },
    });
    await expect(service.findMe('user-1')).resolves.toMatchObject({
      profile: {
        birthday: '1998-03-04',
        height: 193,
        weight: 81.25,
      },
    });
  });

  it('returns 404 when the current user does not exist', async () => {
    repository.findMe.mockResolvedValue(null);
    await expect(service.findMe('missing')).rejects.toThrow(NotFoundException);
  });

  it('sends partial updates as date-safe Prisma values', async () => {
    repository.upsertMyProfile.mockResolvedValue({
      id: 'user-1',
      profile: {
        birthday: new Date('1998-03-04T00:00:00.000Z'),
        name: 'Athlete',
        height: null,
        weight: { toString: () => '21.50' },
      },
    });

    const result = await service.updateMe('user-1', {
      name: 'Athlete',
      birthday: '1998-03-04',
      weight: 21.5,
    });

    expect(repository.upsertMyProfile).toHaveBeenCalledWith('user-1', {
      name: 'Athlete',
      birthday: new Date('1998-03-04T00:00:00.000Z'),
      height: undefined,
      weight: 21.5,
    });
    expect(result.profile?.birthday).toBe('1998-03-04');
    expect(result.profile?.weight).toBe(21.5);
  });

  it('allows clearing nullable profile fields', async () => {
    repository.upsertMyProfile.mockResolvedValue({
      id: 'user-1',
      profile: {
        name: null,
        birthday: null,
        height: null,
        weight: null,
      },
    });

    const result = await service.updateMe('user-1', {
      name: null,
      birthday: null,
    });
    expect(result.profile?.name).toBeNull();
    expect(repository.upsertMyProfile).toHaveBeenCalledWith('user-1', {
      name: null,
      birthday: null,
      height: undefined,
      weight: undefined,
    });
  });
});
