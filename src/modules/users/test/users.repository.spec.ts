import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/index.js';
import { ViewUserDto } from '../dto/view-user.dto.js';
import { UsersRepository } from '../users.repository.js';

describe('UsersRepository', () => {
  let repository: UsersRepository;

  const prisma = {
    users: {
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
    it('should create a user without returning passHash', async () => {
      const input = {
        email: 'test@example.com',
        password: 'hashed-password',
      };

      const createUser = {
        id: 'user-1',
        email: input.email,
      } as ViewUserDto;

      prisma.users.create.mockResolvedValue(createUser);

      const result = await repository.create(input);

      expect(prisma.users.create).toHaveBeenCalledWith({
        data: {
          email: input.email,
          passHash: input.password,
        },
        omit: {
          passHash: true,
        },
      });

      expect(result).toEqual(createUser);
      expect(result).not.toHaveProperty('passHash');
    });
  });

  describe('findUserByEmail', () => {
    it('should return a user when found', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
      } as ViewUserDto;

      prisma.users.findUnique.mockResolvedValue(user);

      const result = await repository.findUserByEmail('test@example.com');

      expect(prisma.users.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        omit: { passHash: true },
      });

      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when user is missing', async () => {
      prisma.users.findUnique.mockResolvedValue(null);

      await expect(
        repository.findUserByEmail('missing@example.com'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkEmail', () => {
    it('should throw ConflictException when email already exist', async () => {
      prisma.users.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      await expect(repository.checkEmail('test@example.com')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should not throw when email. is available', async () => {
      prisma.users.findUnique.mockResolvedValue(null);

      await expect(
        repository.checkEmail('new@example.com'),
      ).resolves.toBeUndefined();
    });
  });

  describe('markEmailVerified', () => {
    it('should mark email as verified when it matches', async () => {
      prisma.users.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      prisma.users.update.mockResolvedValue({});

      const result = await repository.markEmailVerified(
        'user-1',
        'test@example.com',
      );

      expect(result).toBe(true);

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
        omit: { passHash: true },
      });
    });

    it('should not update user when email does not match', async () => {
      prisma.users.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      const result = await repository.markEmailVerified(
        'user-1',
        'other@example.com',
      );

      expect(result).toBe(false);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });
});
