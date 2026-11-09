import { Logger, NotFoundException } from '@nestjs/common';

import { AvatarService } from '../avatar/avatar.service.js';
import { AvatarDiskStorage } from '../avatar/avatar-disk.storage.js';
import { AvatarImageProcessor } from '../avatar/avatar-image.processor.js';
import { UsersRepository } from '../repositories/users.repository.js';

describe('AvatarService', () => {
  const repository = {
    replaceAvatar: vi.fn(),
    isCurrentAvatar: vi.fn(),
  };
  const storage = { save: vi.fn(), remove: vi.fn(), read: vi.fn() };
  const processor = { process: vi.fn() };
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
      processor as unknown as AvatarImageProcessor,
    );
    storage.save.mockResolvedValue(key);
    processor.process.mockImplementation(async (file: { buffer: Buffer }) => ({
      bytes: file.buffer, extension: 'png',
    }));
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

  it('does not write any bytes when the image decoder rejects an upload', async () => {
    processor.process.mockRejectedValueOnce(new Error('invalid image'));

    await expect(service.upload('user-1', {
      buffer: bytes, size: bytes.length, mimetype: 'image/png',
    })).rejects.toThrow('invalid image');

    expect(storage.save).not.toHaveBeenCalled();
    expect(repository.replaceAvatar).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('stores sanitized processor output rather than the uploaded raw bytes', async () => {
    const sanitized = Buffer.from('decoded and re-encoded pixels');
    processor.process.mockResolvedValueOnce({ bytes: sanitized, extension: 'png' });

    await service.upload('user-1', {
      buffer: bytes, size: bytes.length, mimetype: 'image/png',
    });

    expect(storage.save).toHaveBeenCalledWith(sanitized, 'png');
    expect(storage.save).not.toHaveBeenCalledWith(bytes, 'png');
  });

  it('cleans the newly stored image on DB failure', async () => {
    repository.replaceAvatar.mockRejectedValue(new Error('DB failed'));
    await expect(service.upload('user-1', {
      buffer: bytes, size: bytes.length, mimetype: 'image/png',
    })).rejects.toThrow('DB failed');
    expect(storage.remove).toHaveBeenCalledWith(key);
    expect(storage.remove).not.toHaveBeenCalledWith(old);
  });

  it('does not expose avatar keys, filesystem paths or exception messages when old-file cleanup fails', async () => {
    const secret = '/srv/private/uploads/avatars/' + old;
    const error = new Error(`EACCES unlink ${secret}: TOKEN_SECRET`);
    const warn = vi.spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    storage.remove.mockRejectedValueOnce(error);

    await expect(service.upload('user-1', {
      buffer: bytes, size: bytes.length, mimetype: 'image/png',
    })).resolves.toEqual({ avatarUrl: `/avatars/${key}` });

    expect(warn).toHaveBeenCalledExactlyOnceWith('AVATAR_CLEANUP_FAILED');
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(old);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('TOKEN_SECRET');
    warn.mockRestore();
  });

  it('preserves the repository error on upload rollback and safely logs cleanup failure', async () => {
    const dbError = new Error('database commit failed');
    repository.replaceAvatar.mockRejectedValueOnce(dbError);
    storage.remove.mockRejectedValueOnce(
      new Error(`Failed unlink ${key}: token-private`),
    );
    const warn = vi.spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.upload('user-1', {
      buffer: bytes, size: bytes.length, mimetype: 'image/png',
    })).rejects.toBe(dbError);

    expect(storage.remove).toHaveBeenCalledWith(key);
    expect(warn).toHaveBeenCalledExactlyOnceWith('AVATAR_CLEANUP_FAILED');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
    warn.mockRestore();
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
