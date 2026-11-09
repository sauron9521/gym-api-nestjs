import { mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AvatarDiskStorage } from '../avatar/avatar-disk.storage.js';

describe('AvatarDiskStorage orphan scanning', () => {
  let directory: string;
  let storage: AvatarDiskStorage;
  const old = '12345678-1234-4123-8123-123456789abc.png';
  const recent = '12345678-1234-4123-8123-123456789abd.jpg';
  const linked = '12345678-1234-4123-8123-123456789abe.webp';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gym-avatar-test-'));
    storage = new AvatarDiskStorage({
      get: () => directory,
    } as never);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('ignores untrusted names, symlinks and recent files; only scans old regular files', async () => {
    await writeFile(join(directory, old), 'valid');
    await writeFile(join(directory, recent), 'valid');
    await writeFile(join(directory, 'not-an-avatar.png'), 'invalid name');
    await symlink(join(directory, old), join(directory, linked));
    const oneDayAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(join(directory, old), oneDayAgo, oneDayAgo);
    await utimes(join(directory, 'not-an-avatar.png'), oneDayAgo, oneDayAgo);

    const keys = await storage.listOldKeys(new Date(Date.now() - 24 * 60 * 60 * 1000));
    expect(keys).toEqual([old]);

    await storage.remove(old);
    expect(await storage.listOldKeys(new Date(Date.now() + 60_000))).toEqual([recent]);
  });

  it('treats a missing storage directory as an empty collection', async () => {
    await rm(directory, { recursive: true, force: true });
    expect(await storage.listOldKeys(new Date())).toEqual([]);
  });

  it('respects the cleanup batch limit', async () => {
    for (let i = 0; i < 3; i++) {
      const key = `12345678-1234-4123-8123-${(123456789000 + i).toString()}.png`;
      await writeFile(join(directory, key), 'old avatar');
      const date = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await utimes(join(directory, key), date, date);
    }

    expect((await storage.listOldKeys(new Date(), 2)).length).toBe(2);
  });
});
