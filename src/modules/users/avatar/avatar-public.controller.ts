import {
  Controller, Get, Param, Res, StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { AvatarService } from './avatar.service.js';

@Controller('avatars')
export class AvatarPublicController {
  constructor(private readonly avatarService: AvatarService) {}

  /** Public by unguessable key, but only while assigned to an active user. */
  @Get(':key')
  async get(
    @Param('key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const avatar = await this.avatarService.readPublic(key);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    return new StreamableFile(avatar.bytes, {
      type: avatar.contentType,
      disposition: 'inline',
    });
  }
}
