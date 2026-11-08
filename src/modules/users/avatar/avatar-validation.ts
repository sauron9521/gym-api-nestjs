import { BadRequestException } from '@nestjs/common';

/** Fast hard limits before writing bytes to storage. */
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
export type AvatarExtension = 'png' | 'jpg' | 'webp';
export type AvatarUploadFile = {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname?: string;
};

const MEDIA_TYPES: Record<AvatarExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export function avatarMimeForKey(key: string): string {
  const extension = key.split('.').at(-1);
  if (extension !== 'png' && extension !== 'jpg' && extension !== 'webp') {
    throw new BadRequestException('Invalid avatar key');
  }
  return MEDIA_TYPES[extension];
}

export function assertAvatarKey(key: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(key)) {
    throw new BadRequestException('Invalid avatar key');
  }
}

/**
 * Reject empty, oversized, mismatched or non-raster data. We accept no SVG,
 * HTML or arbitrary files even if the client labels them image/png.
 */
export function validateAvatar(file?: AvatarUploadFile): AvatarExtension {
  if (!file?.buffer || file.buffer.length === 0) {
    throw new BadRequestException('An image file is required in field "file"');
  }
  if (
    file.buffer.length > MAX_AVATAR_SIZE ||
    file.size > MAX_AVATAR_SIZE
  ) {
    throw new BadRequestException('Avatar exceeds 2 MiB');
  }

  const bytes = file.buffer;
  let ext: AvatarExtension | null = null;
  let width: number | null = null;
  let height: number | null = null;

  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    ext = 'png';
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (
    bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[2] === 0xff && bytes[bytes.length-2] === 0xff &&
    bytes[bytes.length-1] === 0xd9
  ) {
    ext = 'jpg';
    // Read JPEG frame dimensions without decoding the full image.
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset+1]!;
      offset += 2;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xcf) &&
        ![0xc4, 0xc8, 0xcc].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      ext = 'webp';
      width = bytes.readUIntLE(24, 3) + 1;
      height = bytes.readUIntLE(27, 3) + 1;
    } else if (kind === 'VP8 ' && bytes.length >= 30 && bytes.toString('hex', 23, 26) === '9d012a') {
      ext = 'webp';
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      ext = 'webp';
      const bits = bytes.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }

  if (!ext || width === null || height === null) {
    throw new BadRequestException('Unsupported or invalid avatar image');
  }
  if (width < 1 || width > 4096 || height < 1 || height > 4096) {
    throw new BadRequestException('Avatar dimensions must be within 1–4096 pixels');
  }
  if (file.mimetype !== MEDIA_TYPES[ext]) {
    throw new BadRequestException('Content-Type does not match image bytes');
  }

  return ext;
}
