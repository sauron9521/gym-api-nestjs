import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/index.js';
import {
  userSelect,
  userSelectWithCredentials,
  userWithProfileSelect,
  UsersRepository,
} from '../users.repository.js';
import { UserResponse } from '../dto/response-user.js';
import { Prisma, type User } from '../../../infra/database/generated/prisma/client.js';

describe('UsersRepository', () => {
  let repository: UsersRepository;

  const prisma = {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();

    repository = new UsersRepository(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('should create a user without returning passwordHash', async () => {
      const input = {
        email: 'test@example.com',
        passwordHash: 'hashed-password',
      };

      const createUser = {
        id: 'user-1',
        email: input.email,
      } as UserResponse;

      prisma.user.create.mockResolvedValue(createUser);

      const result = await repository.create(input.email, input.passwordHash);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
        },
        select: userSelect,
      });

      expect(result).toEqual(createUser);
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should throw ConflictException when email already exists', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        {
          code: 'P2002',
          clientVersion: '7.10.1',
          meta: {
            modelName: 'User',
            target: ['email'],
          },
        },
      );

      prisma.user.create.mockRejectedValue(prismaError);

      await expect(
        repository.create('test@example.com', 'hashed-password'),
      ).rejects.toThrow(ConflictException);
    });

    it('should normalize email before creating a user', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
      } as UserResponse;

      prisma.user.create.mockResolvedValue(user);

      const result = await repository.create(
        '  User@Example.COM  ',
        'hashed-password',
      );

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'user@example.com',
          passwordHash: 'hashed-password',
        },
        select: userSelect,
      });

      expect(result).toEqual(user);
    });

    it('should rethrow unexpected database errors', async () => {
      const error = new Error('Database connection failed');

      prisma.user.create.mockRejectedValue(error);

      await expect(
        repository.create('test@example.com', 'hashed-password'),
      ).rejects.toBe(error);
    });
  });

  describe('findUserByEmail', () => {
    it('should return a user when found', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
      } as UserResponse;

      prisma.user.findUnique.mockResolvedValue(user);

      const result = await repository.findUserByEmail('test@example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: userSelect,
      });

      expect(result).toEqual(user);
    });

    it('should returned Null when user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        repository.findUserByEmail('missing@example.com'),
      ).resolves.toBeNull();
    });

    it('should normalize email before searching for a user', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
      } as UserResponse;

      prisma.user.findUnique.mockResolvedValue(user);

      const result = await repository.findUserByEmail('  USER@EXAMPLE.COM  ');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        select: userSelect,
      });

      expect(result).toEqual(user);
    });
  });

  describe('checkEmail', () => {
    it('should throw ConflictException when email already exist', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      await expect(repository.checkEmail('test@example.com')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should not throw when email. is available', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        repository.checkEmail('new@example.com'),
      ).resolves.toBeUndefined();
    });

    it('should detect an existing email regardless of case', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });

      await expect(
        repository.checkEmail('  USER@EXAMPLE.COM  '),
      ).rejects.toThrow(ConflictException);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        select: userSelect,
      });
    });
  });

  describe('markEmailVerified', () => {
    it('should mark email as verified when it matches', async () => {
      prisma.user.findUnique.mockResolvedValue({
        userId: 'user-1',
        email: 'test@example.com',
      });

      prisma.user.update.mockResolvedValue({});

      const result = await repository.markEmailVerified(
        'user-1',
        'test@example.com',
      );

      expect(result).toBe(true);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
        select: {
          id: true,
          email: true,
          emailVerified: true,
        },
      });
    });

    it('should not update user when email does not match', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      const result = await repository.markEmailVerified(
        'user-1',
        'other@example.com',
      );

      expect(result).toBe(false);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('findUserById', () => {
    it('should return a user when found', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
      } as UserResponse;

      prisma.user.findUnique.mockResolvedValue(user);

      const result = await repository.findUserById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
        select: userSelect,
      });
      expect(result).toEqual(user);
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should return null when user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(repository.findUserById('missing-id')).resolves.toBeNull();
    });
  });

  describe('findCredentials', () => {
    it('should return credentials when user exists', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
      } as User;

      prisma.user.findUnique.mockResolvedValue(user);

      const result = await repository.findCredentials(user.email);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: user.email, deletedAt: null },
        select: userSelectWithCredentials,
      });

      expect(result).toEqual(user);
      expect(result?.passwordHash).toBe('hashed-password');
    });

    it('should return null when user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await repository.findCredentials('missing@example.com');

      expect(result).toBeNull();
    });

    it('should normalize email before finding credentials', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'hashed-password',
      } as User;

      prisma.user.findUnique.mockResolvedValue(user);

      const result = await repository.findCredentials('  USER@EXAMPLE.COM  ');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: {
          email: 'user@example.com',
          deletedAt: null,
        },
        select: userSelectWithCredentials,
      });

      expect(result).toEqual(user);
    });
  });

  describe('updatePassHash', () => {
    it('should update the password hash', async () => {
      prisma.user.update.mockResolvedValue({});

      await repository.updatePassHash('user-1', 'new-hash');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-hash' },
        select: userSelect,
      });
    });
  });
  describe('profile', () => {
    it('reads only the current active user and safe profile fields', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        profile: null,
      };
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await repository.findMe('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
        select: userWithProfileSelect,
      });
      expect(result).toEqual(user);
      expect(userWithProfileSelect.profile.select).toEqual({
        name: true,
        firstName: true,
        lastName: true,
        displayName: true,
        avatarUrl: true,
        timezone: true,
        birthday: true,
        height: true,
        weight: true,
      });
      expect(userWithProfileSelect).not.toHaveProperty('passwordHash');
      expect(userWithProfileSelect.profile.select).not.toHaveProperty('userId');
    });

    it('upserts only profile fields on the authenticated user', async () => {
      const data = { name: 'Athlete', height: 193 };
      const user = { id: 'user-1', profile: data };
      prisma.user.update.mockResolvedValue(user);

      const result = await repository.upsertMyProfile('user-1', data);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
        data: {
          profile: {
            upsert: { create: data, update: data },
          },
        },
        select: userWithProfileSelect,
      });
      expect(result).toEqual(user);
    });

    it('maps missing or deleted user updates to 404', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Missing user', {
          code: 'P2025',
          clientVersion: '7.10.1',
        }),
      );
      await expect(
        repository.upsertMyProfile('missing', { name: 'Test' }),
      ).rejects.toThrow('User not found');
    });

    it('does not swallow unexpected database errors', async () => {
      const error = new Error('Database unavailable');
      prisma.user.update.mockRejectedValue(error);
      await expect(
        repository.upsertMyProfile('user-1', { name: 'Athlete' }),
      ).rejects.toBe(error);
    });
  });

});
