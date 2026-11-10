import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import { AvatarPublicController } from '../../controllers/avatar-public.controller.js';
import { AvatarService } from '../../avatar/avatar.service.js';

describe('AvatarPublicController', () => {
  const service = { readPublic: vi.fn() };
  let controller: AvatarPublicController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new AvatarPublicController(service as unknown as AvatarService);
  });

  it('serves only validated active avatar data with security and cache headers', async () => {
    const key = '11111111-1111-4111-8111-111111111111.png';
    const bytes = Buffer.from('image');
    const response = { setHeader: vi.fn() } as unknown as Response;
    service.readPublic.mockResolvedValue({ bytes, contentType: 'image/png' });

    const result = await controller.get(key, response);

    expect(service.readPublic).toHaveBeenCalledExactlyOnceWith(key);
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cross-Origin-Resource-Policy',
      'cross-origin',
    );
    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders()).toMatchObject({
      type: 'image/png',
      disposition: 'inline',
    });
  });

  it('propagates missing avatar errors before sending response headers', async () => {
    const error = new Error('Avatar not found');
    const response = { setHeader: vi.fn() } as unknown as Response;
    service.readPublic.mockRejectedValue(error);

    await expect(controller.get('unknown.png', response)).rejects.toBe(error);
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
