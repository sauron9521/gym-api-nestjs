import { randomInt, randomUUID } from 'node:crypto';
import { lstat, mkdir, opendir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfigService } from '#src/common/config/app-config.types';

import { assertAvatarKey, type AvatarExtension } from './avatar-validation.js';

/**
 * Local filesystem adapter for development and single-server deployments.
 * Replace with persistent object storage for multi-instance production.
 */
@Injectable()
export class AvatarDiskStorage {
  private readonly directory: string;

  constructor(@Inject(ConfigService) config: AppConfigService) {
    this.directory = resolve(
      config.get('AVATAR_STORAGE_DIR') ||
        join(process.cwd(), 'uploads', 'avatars'),
    );
  }

  async save(bytes: Buffer, extension: AvatarExtension): Promise<string> {
    const key = `${randomUUID()}.${extension}`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, key), bytes, { flag: 'wx', mode: 0o600 });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    assertAvatarKey(key);
    try {
      return await readFile(join(this.directory, key));
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundException('Avatar not found');
      throw error;
    }
  }

  /**
   * Select a bounded, uniformly sampled batch from all aged regular files.
   * Sampling prevents permanently missing orphans when the directory begins
   * with more than 100 still-referenced files. The caller checks the DB
   * before deleting anything. The one-day grace period protects uploads.
   */
  async listOldKeys(before: Date, limit = 100): Promise<string[]> {
    let directory: Awaited<ReturnType<typeof opendir>>;
    try {
      directory = await opendir(this.directory);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    if (limit < 1) {
      await directory.close();
      return [];
    }

    const keys: string[] = [];
    let eligible = 0;
    for await (const entry of directory) {
      if (!entry.isFile()) continue;
      try {
        assertAvatarKey(entry.name);
      } catch {
        continue;
      }

      try {
        const info = await lstat(join(this.directory, entry.name));
        if (info.isFile() && info.mtimeMs < before.getTime()) {
          eligible++;
          if (keys.length < limit) {
            keys.push(entry.name);
          } else {
            // Reservoir sampling: every old file can enter a later batch,
            // even if earlier names remain valid DB references forever.
            const index = randomInt(eligible);
            if (index < limit) keys[index] = entry.name;
          }
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }

    }

    return keys;
  }

  async remove(key: string): Promise<void> {
    assertAvatarKey(key);
    try {
      await unlink(join(this.directory, key));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
