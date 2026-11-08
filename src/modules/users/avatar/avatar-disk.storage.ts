import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { assertAvatarKey, type AvatarExtension } from './avatar-validation.js';

/**
 * Local filesystem adapter for development and single-server deployments.
 * Replace with persistent object storage for multi-instance production.
 */
@Injectable()
export class AvatarDiskStorage {
  private readonly directory: string;

  constructor(config: ConfigService) {
    this.directory = resolve(
      config.get<string>('AVATAR_STORAGE_DIR') ||
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
