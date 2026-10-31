import { PasswordHasher } from '@nestjs/authentication';
import { randomUUID } from 'node:crypto';
import type { User } from '../../../../generated/prisma/client.js';
import { UsersRepository } from '../../../users/users.repository.js';
import { CredentialsService } from '../../services/index.js';
import { UserResponse } from '../../../users/dto/response-user.js';
import { SignInDto } from '../../dto/auth.dto.js';

describe('Credentials service', () => {
  let service: CredentialsService;

  const userRepository = {
    checkEmail: vi.fn(),
    create: vi.fn(),
    findCredentials: vi.fn(),
    updatePassHash: vi.fn(),
  };

  const passwordHasher = {
    hash: vi.fn(),
    verify: vi.fn(),
    needsRehash: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();

    service = new CredentialsService(
      userRepository as unknown as UsersRepository,
      passwordHasher as unknown as PasswordHasher,
    );
  });

  describe('register', () => {
    it('Should hash the password and create user', async () => {
      const dto: SignInDto = {
        email: 'test123@example.com',
        password: 'StrongPassword123!@',
      };

      const createUser = {
        id: 'user-1',
        email: dto.email,
      } as UserResponse;

      passwordHasher.hash.mockResolvedValue('hashed-password');
      userRepository.create.mockResolvedValue(createUser);

      const result = await service.register(dto);

      expect(userRepository.checkEmail).toHaveBeenCalledWith(dto.email);
      expect(passwordHasher.hash).toHaveBeenCalledWith(dto.password);
      expect(userRepository.create).toHaveBeenCalledWith(
        dto.email,
        'hashed-password',
      );
      expect(result).toEqual(createUser);
    });

    it('should not created a user if the email already exists', async () => {
      const error = new Error('Email already exists');
      userRepository.checkEmail.mockRejectedValue(error);

      await expect(
        service.register({
          email: 'test@exaple.com',
          password: 'StrongPassword123!@',
        }),
      ).rejects.toBe(error);

      expect(passwordHasher.hash).not.toHaveBeenCalled();
      expect(userRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('should return null when the password is invalid', async () => {
      const user = {
        id: randomUUID(),
        email: 'test@example.com',
        passwordHash: 'stored-hash',
      } as unknown as User;

      userRepository.findCredentials.mockResolvedValue(user);
      passwordHasher.verify.mockResolvedValue(false);

      const result = await service.verify(
        'test@example.com',
        'WrongPassword123!@',
      );

      expect(result).toBeNull();
      expect(passwordHasher.verify).toHaveBeenCalledWith(
        'WrongPassword123!@',
        'stored-hash',
      );
      expect(passwordHasher.needsRehash).not.toHaveBeenCalled();
    });

    it('should return the user without the password hash', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'store-hash',
      } as unknown as User;

      userRepository.findCredentials.mockResolvedValue(user);
      passwordHasher.verify.mockResolvedValue(true);
      passwordHasher.needsRehash.mockResolvedValue(false);

      const result = await service.verify(user.email, 'StrongPassword123!@');

      expect(result).toEqual({
        id: user.id,
        email: user.email,
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it("should return null the user doesn't exist", async () => {
      userRepository.findCredentials.mockResolvedValue(null);

      const result = await service.verify(
        'misssing@examle.com',
        'StrongPassword123!@',
      );

      expect(result).toBeNull();
      expect(userRepository.findCredentials).toHaveBeenCalledWith(
        'misssing@examle.com',
      );
    });

    it('should rehash the password when the store hash needs updating', async () => {
      const user = {
        id: randomUUID(),
        email: 'test@example.com',
        passwordHash: 'old-hash',
      } as unknown as User;

      userRepository.findCredentials.mockResolvedValue(user);
      passwordHasher.verify.mockResolvedValue(true);
      passwordHasher.needsRehash.mockResolvedValue(true);
      passwordHasher.hash.mockResolvedValue('new-hash');

      const result = await service.verify(
        'test@exmaple.com',
        'StrongPassword123!',
      );

      expect(passwordHasher.needsRehash).toHaveBeenCalledWith('old-hash');
      expect(passwordHasher.hash).toHaveBeenCalledWith('StrongPassword123!');
      expect(userRepository.updatePassHash).toHaveBeenCalledWith(
        user.id,
        'new-hash',
      );
      expect(result).not.toHaveProperty('passwordHash');
    });
  });
});
