import { BadRequestException, Injectable } from '@nestjs/common';
import sharp, { type Sharp } from 'sharp';

import {
  MAX_AVATAR_SIZE,
  validateAvatar,
  type AvatarExtension,
  type AvatarUploadFile,
} from './avatar-validation.js';

/** Hard limits applied both before and during decoding. */
export const MAX_AVATAR_PIXELS = 4096 * 4096;
export const MAX_AVATAR_DIMENSION = 4096;
export const OUTPUT_AVATAR_DIMENSION = 512;

export type ProcessedAvatar = {
  extension: AvatarExtension;
  bytes: Buffer;
};

/**
 * Decode, orient, resize, then re-encode. Never persist untrusted source bytes:
 * valid headers alone are insufficient to validate the compressed pixel stream.
 * sharp strips EXIF/ICC/XMP and arbitrary ancillary metadata by default.
 */
@Injectable()
export class AvatarImageProcessor {
  async process(file?: AvatarUploadFile): Promise<ProcessedAvatar> {
    const extension = validateAvatar(file);
    const input = file!.buffer;
    const format = extension === 'jpg' ? 'jpeg' : extension;

    try {
      const options = {
        failOn: 'error' as const,
        limitInputPixels: MAX_AVATAR_PIXELS,
        animated: false,
      };
      const metadata = await sharp(input, options).metadata();

      if (
        metadata.format !== format ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > MAX_AVATAR_DIMENSION ||
        metadata.height > MAX_AVATAR_DIMENSION ||
        metadata.width * metadata.height > MAX_AVATAR_PIXELS ||
        (metadata.pages ?? 1) !== 1 ||
        (metadata.delay?.length ?? 0) > 1 ||
        (metadata.pageHeight !== undefined &&
          metadata.pageHeight !== metadata.height)
      ) {
        throw new BadRequestException('Unsupported or invalid avatar image');
      }

      let pipeline: Sharp = sharp(input, options)
        .rotate()
        .resize({
          width: OUTPUT_AVATAR_DIMENSION,
          height: OUTPUT_AVATAR_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        });

      // Explicit output format; never persist trailing bytes or metadata from
      // uploads (including malformed EXIF, comments, profiles or embedded code).
      if (extension === 'png') {
        pipeline = pipeline.png({ compressionLevel: 9 });
      } else if (extension === 'jpg') {
        pipeline = pipeline.jpeg({ quality: 82 });
      } else {
        pipeline = pipeline.webp({ quality: 82, effort: 4 });
      }

      const bytes = await pipeline.toBuffer();
      if (bytes.length === 0 || bytes.length > MAX_AVATAR_SIZE) {
        throw new BadRequestException('Avatar cannot be processed');
      }

      return { bytes, extension };
    } catch {
      // Never pass sharp's internal decode paths or image metadata to clients.
      throw new BadRequestException('Unsupported or invalid avatar image');
    }
  }
}
