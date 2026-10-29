import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/index.js';
import {
  userSelect,
  userSelectWithCredentials,
  UsersRepository,
} from '../users.repository.js';
import { UserResponse } from '../dto/response-user.js';
import type { User } from '../../../generated/prisma/client.js';

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
        where: { id: 'user-1' },
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
        where: { email: user.email },
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
});
