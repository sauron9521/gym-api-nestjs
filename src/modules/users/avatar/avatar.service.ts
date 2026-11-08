import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { UsersRepository } from '../users.repository.js';
import { AvatarDiskStorage } from './avatar-disk.storage.js';
import {
  assertAvatarKey,
  avatarMimeForKey,
  validateAvatar,
  type AvatarUploadFile,
} from './avatar-validation.js';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly storage: AvatarDiskStorage,
  ) {}

  async upload(userId: string, file?: AvatarUploadFile) {
    const extension = validateAvatar(file);
    const key = await this.storage.save(file!.buffer, extension);
    const avatarUrl = `/avatars/${key}`;

    let previousKey: string | null;
    try {
      const updated = await this.usersRepository.replaceAvatar(
        userId,
        { avatarUrl },
        key,
      );
      previousKey = updated.previousKey;
    } catch (error) {
      await this.removePrevious(key);
      throw error;
    }

    // Deleting AFTER the DB commit prevents the prior avatar being lost
    // when an update fails. A failed deletion never undoes the new profile.
    await this.removePrevious(previousKey);
    return { avatarUrl };
  }

  async delete(userId: string) {
    const result = await this.usersRepository.replaceAvatar(
      userId,
      { avatarUrl: null },
      null,
      true,
    );
    await this.removePrevious(result.previousKey);
    return { avatarUrl: null };
  }

  async readPublic(key: string) {
    assertAvatarKey(key);
    if (!(await this.usersRepository.isCurrentAvatar(key))) {
      throw new NotFoundException('Avatar not found');
    }

    return {
      bytes: await this.storage.read(key),
      contentType: avatarMimeForKey(key),
    };
  }

  async removePrevious(key: string | null): Promise<void> {
    if (!key) return;

    try {
      await this.storage.remove(key);
    } catch (error) {
      // An orphan is recoverable; we must not report failure after a DB
      // transaction has already committed or delete the current blob.
      this.logger.warn(`Unable to clean old avatar ${key}: ${String(error)}`);
    }
  }
}
