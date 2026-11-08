import { NotFoundException } from '@nestjs/common';

import { AvatarService } from '../avatar/avatar.service.js';
import { AvatarDiskStorage } from '../avatar/avatar-disk.storage.js';
import { UsersRepository } from '../users.repository.js';

describe('AvatarService', () => {
  const repository = {
    replaceAvatar: vi.fn(),
    isCurrentAvatar: vi.fn(),
  };
  const storage = { save: vi.fn(), remove: vi.fn(), read: vi.fn() };
  let service: AvatarService;
  const key = '12345678-1234-4123-8123-123456789abc.png';
  const old = '12345678-1234-4123-8123-123456789abd.png';
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lGQAAAAASUVORK5CYII=',
    'base64',
  );

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AvatarService(
      repository as unknown as UsersRepository,
      storage as unknown as AvatarDiskStorage,
    );
    storage.save.mockResolvedValue(key);
    repository.replaceAvatar.mockResolvedValue({
      user: { id: 'user-1' }, previousKey: old,
    });
  });

  it('persists a new avatar and removes the previous one after success', async () => {
    await expect(service.upload('user-1', {
      buffer: bytes, size: bytes.length, mimetype: 'image/png',
    })).resolves.toEqual({ avatarUrl: `/avatars/${key}` });

    expect(repository.replaceAvatar).toHaveBeenCalledWith(
      'user-1', { avatarUrl: `/avatars/${key}` }, key,
    );
    expect(storage.remove).toHaveBeenCalledWith(old);
  });

  it('cleans the newly stored image on DB failure', async () => {
    repository.replaceAvatar.mockRejectedValue(new Error('DB failed'));
    await expect(service.upload('user-1', {
      buffer: bytes, size: bytes.length, mimetype: 'image/png',
    })).rejects.toThrow('DB failed');
    expect(storage.remove).toHaveBeenCalledWith(key);
    expect(storage.remove).not.toHaveBeenCalledWith(old);
  });

  it('returns 404 for an orphaned avatar key', async () => {
    repository.isCurrentAvatar.mockResolvedValue(false);
    await expect(service.readPublic(key)).rejects.toThrow(NotFoundException);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('does not create an empty profile while deleting an absent avatar', async () => {
    repository.replaceAvatar.mockResolvedValue({
      user: { id: 'user-1' }, previousKey: null,
    });
    await service.delete('user-1');
    expect(repository.replaceAvatar).toHaveBeenCalledWith(
      'user-1', { avatarUrl: null }, null, true,
    );
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
