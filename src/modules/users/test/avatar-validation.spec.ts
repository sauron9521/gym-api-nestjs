import { BadRequestException } from '@nestjs/common';
import { assertAvatarKey, avatarMimeForKey, validateAvatar, MAX_AVATAR_SIZE } from '../avatar/avatar-validation.js';

describe('avatar validation', () => {
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lGQAAAAASUVORK5CYII=',
    'base64',
  );

  it('accepts a well-formed PNG header and dimensions', () => {
    expect(validateAvatar({ buffer: tinyPng, size: tinyPng.length, mimetype: 'image/png' })).toBe('png');
  });

  it('rejects MIME spoofing, empty bodies and oversized files', () => {
    for (const file of [
      { buffer: tinyPng, size: tinyPng.length, mimetype: 'text/plain' },
      { buffer: Buffer.from('not a png'), size: 9, mimetype: 'image/png' },
      { buffer: Buffer.alloc(0), size: 0, mimetype: 'image/png' },
      { buffer: tinyPng, size: MAX_AVATAR_SIZE + 1, mimetype: 'image/png' },
    ]) {
      expect(() => validateAvatar(file)).toThrow(BadRequestException);
    }
  });

  it('rejects malformed public keys and resolves safe content types', () => {
    expect(() => assertAvatarKey('../evil.png')).toThrow(BadRequestException);
    expect(() => assertAvatarKey('not-a-uuid.jpg')).toThrow(BadRequestException);
    const key = '12345678-1234-4123-8123-123456789abc.png';
    expect(() => assertAvatarKey(key)).not.toThrow();
    expect(avatarMimeForKey(key)).toBe('image/png');
  });
});
