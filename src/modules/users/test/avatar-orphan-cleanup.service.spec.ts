import { Logger } from '@nestjs/common';

import { AvatarOrphanCleanupService } from '../avatar/avatar-orphan-cleanup.service.js';
import { AvatarDiskStorage } from '../avatar/avatar-disk.storage.js';
import { UsersRepository } from '../repositories/users.repository.js';

describe('AvatarOrphanCleanupService', () => {
  const referenced = '12345678-1234-4123-8123-123456789abc.png';
  const orphan = '12345678-1234-4123-8123-123456789abd.webp';
  const broken = '12345678-1234-4123-8123-123456789abe.jpg';

  const storage = {
    listOldKeys: vi.fn(),
    remove: vi.fn(),
  };
  const repository = {
    isCurrentAvatar: vi.fn(),
  };
  let service: AvatarOrphanCleanupService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AvatarOrphanCleanupService(
      repository as unknown as UsersRepository,
      storage as unknown as AvatarDiskStorage,
    );
    storage.listOldKeys.mockResolvedValue([referenced, orphan]);
    storage.remove.mockResolvedValue(undefined);
    repository.isCurrentAvatar.mockImplementation(async (key: string) =>
      key === referenced,
    );
  });

  it('keeps referenced avatars and deletes only old orphaned files', async () => {
    const started = Date.now();
    await service.cleanup();

    expect(storage.remove).toHaveBeenCalledExactlyOnceWith(orphan);
    expect(repository.isCurrentAvatar).toHaveBeenCalledWith(referenced);
    expect(repository.isCurrentAvatar).toHaveBeenCalledWith(orphan);
    expect(storage.listOldKeys).toHaveBeenCalledTimes(1);

    const [before, limit] = storage.listOldKeys.mock.calls[0] as [Date, number];
    expect(limit).toBe(100);
    expect(before.getTime()).toBeGreaterThanOrEqual(
      started - 24 * 60 * 60 * 1000 - 5000,
    );
    expect(before.getTime()).toBeLessThan(Date.now() - 24 * 60 * 60 * 1000 + 5000);
  });

  it('logs a stable scan failure without filesystem paths', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    storage.listOldKeys.mockRejectedValueOnce(new Error('EACCES /srv/secrets'));

    try {
      await expect(service.cleanup()).resolves.toBeUndefined();
      expect(storage.remove).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('AVATAR_ORPHAN_SCAN_FAILED');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('/srv/secrets');
    } finally {
      warn.mockRestore();
    }
  });

  it('continues cleanup after a single filesystem failure', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    storage.listOldKeys.mockResolvedValueOnce([broken, orphan]);
    repository.isCurrentAvatar.mockResolvedValue(false);
    storage.remove.mockRejectedValueOnce(new Error('EACCES /path/with/key'));

    try {
      await service.cleanup();
      expect(storage.remove).toHaveBeenCalledTimes(2);
      expect(storage.remove).toHaveBeenNthCalledWith(1, broken);
      expect(storage.remove).toHaveBeenNthCalledWith(2, orphan);
      expect(warn).toHaveBeenCalledWith('AVATAR_ORPHAN_CLEANUP_FAILED');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('/path/with/key');
    } finally {
      warn.mockRestore();
    }
  });

  it('handles a database lookup error without accidentally removing the file', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    storage.listOldKeys.mockResolvedValueOnce([referenced]);
    repository.isCurrentAvatar.mockRejectedValueOnce(new Error('Database offline'));

    try {
      await service.cleanup();
      expect(storage.remove).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('AVATAR_ORPHAN_CLEANUP_FAILED');
    } finally {
      warn.mockRestore();
    }
  });
});
