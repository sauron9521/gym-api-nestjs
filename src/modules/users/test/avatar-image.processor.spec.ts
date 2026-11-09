import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

import {
  AvatarImageProcessor,
  MAX_AVATAR_PIXELS,
  OUTPUT_AVATAR_DIMENSION,
} from '../avatar/avatar-image.processor.js';

import type { AvatarUploadFile } from '../avatar/avatar-validation.js';

describe('AvatarImageProcessor', () => {
  const processor = new AvatarImageProcessor();
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lGQAAAAASUVORK5CYII=',
    'base64',
  );

  const animatedWebp = Buffer.from(
    'UklGRsQAAABXRUJQVlA4WAoAAAACAAAAAgAAAgAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAIAAAIAAGQAAAJWUDggMgAAADABAJ0BKgMAAwABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkYAAAAAAAAAAAACAAACAABkAAAAVlA4IC4AAAA0AQCdASoDAAMAAAAmJaAAA3AA/vtV4///S4P/+lwf/9Lg/9Lg//rV5Vesq6AA',
    'base64',
  );

  function file(buffer: Buffer, mimetype: string): AvatarUploadFile {
    return { buffer, size: buffer.length, mimetype };
  }

  it.each([
    ['image/png', 'png', 'png'],
    ['image/jpeg', 'jpg', 'jpeg'],
    ['image/webp', 'webp', 'webp'],
  ] as const)('decodes and re-encodes %s', async (mimetype, ext, format) => {
    const input = ext === 'png'
      ? tinyPng
      : await sharp(tinyPng).toFormat(format).toBuffer();

    const result = await processor.process(file(input, mimetype));
    const meta = await sharp(result.bytes).metadata();

    expect(result.extension).toBe(ext);
    expect(meta.format).toBe(format);
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.bytes.equals(input)).toBe(false);
  });

  it('normalizes large avatars to at most 512x512 without enlarging', async () => {
    const input = await sharp({
      create: { width: 900, height: 600, channels: 4, background: 'red' },
    }).png().toBuffer();

    const output = await processor.process(file(input, 'image/png'));
    const metadata = await sharp(output.bytes).metadata();

    expect(metadata.width).toBe(OUTPUT_AVATAR_DIMENSION);
    expect(metadata.height).toBeLessThan(OUTPUT_AVATAR_DIMENSION);
    expect(metadata.width! * metadata.height!).toBeLessThan(MAX_AVATAR_PIXELS);
  });

  it('removes embedded EXIF metadata from a valid JPEG', async () => {
    const input = await sharp(tinyPng)
      .withExif({ IFD0: { ImageDescription: 'PRIVATE-AVATAR-METADATA' } })
      .jpeg()
      .toBuffer();

    expect((await sharp(input).metadata()).exif).toBeDefined();

    const output = await processor.process(file(input, 'image/jpeg'));
    const metadata = await sharp(output.bytes).metadata();

    expect(metadata.exif).toBeUndefined();
    expect(output.bytes.includes(Buffer.from('PRIVATE-AVATAR-METADATA'))).toBe(false);
  });

  it('rejects animated images instead of accepting their first frame', async () => {
    expect((await sharp(animatedWebp).metadata()).pages).toBe(2);
    await expect(processor.process(file(animatedWebp, 'image/webp')))
      .rejects.toThrow(BadRequestException);
  });

  it('rejects truncated PNGs even with valid signature and dimensions', async () => {
    const truncated = tinyPng.subarray(0, 33);
    await expect(processor.process(file(truncated, 'image/png')))
      .rejects.toThrow(BadRequestException);
  });

  it('rejects fake MIME, SVG, and invalid pixel data', async () => {
    for (const upload of [
      file(tinyPng, 'image/jpeg'),
      file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png'),
      file(Buffer.alloc(0), 'image/png'),
    ]) {
      await expect(processor.process(upload))
        .rejects.toThrow(BadRequestException);
    }
  });

  it('rejects forged out-of-range dimensions before decoding', async () => {
    const huge = Buffer.from(tinyPng);
    huge.writeUInt32BE(4097, 16);
    await expect(processor.process(file(huge, 'image/png')))
      .rejects.toThrow(BadRequestException);
  });
});
