import { UsersController } from '../../controllers/users.controller.js';
import { UsersService } from '../../services/users.service.js';
import { AvatarService } from '../../avatar/avatar.service.js';

describe('UsersController', () => {
  const usersService = {
    findMe: vi.fn(),
    updateMe: vi.fn(),
  };
  const avatarService = {
    upload: vi.fn(),
    delete: vi.fn(),
  };
  const actor = { id: 'user-1' };
  let controller: UsersController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new UsersController(
      usersService as unknown as UsersService,
      avatarService as unknown as AvatarService,
    );
  });

  it('reads the authenticated user profile without a client-provided user ID', async () => {
    const profile = { id: actor.id, email: 'athlete@example.test', profile: null };
    usersService.findMe.mockResolvedValue(profile);

    await expect(controller.me(actor)).resolves.toBe(profile);
    expect(usersService.findMe).toHaveBeenCalledExactlyOnceWith(actor.id);
  });

  it('delegates profile updates with the authenticated user ID and decimal weight', async () => {
    const body = { displayName: 'Athlete', weight: 81.25 };
    const profile = { id: actor.id, profile: body };
    usersService.updateMe.mockResolvedValue(profile);

    await expect(controller.updateMe(actor, body)).resolves.toBe(profile);
    expect(usersService.updateMe).toHaveBeenCalledExactlyOnceWith(actor.id, body);
  });

  it('forwards the multipart upload as-is to the avatar service', async () => {
    const file = { buffer: Buffer.from('test-data'), size: 9, mimetype: 'image/png' };
    const result = { avatarUrl: '/avatars/example.png' };
    avatarService.upload.mockResolvedValue(result);

    await expect(controller.uploadAvatar(actor, file)).resolves.toBe(result);
    expect(avatarService.upload).toHaveBeenCalledExactlyOnceWith(actor.id, file);
  });

  it('preserves missing-file validation delegation to the avatar service', async () => {
    const error = new Error('Missing avatar file');
    avatarService.upload.mockRejectedValue(error);

    await expect(controller.uploadAvatar(actor, undefined)).rejects.toBe(error);
    expect(avatarService.upload).toHaveBeenCalledExactlyOnceWith(actor.id, undefined);
  });

  it('deletes the avatar for the authenticated account only', async () => {
    const result = { avatarUrl: null };
    avatarService.delete.mockResolvedValue(result);

    await expect(controller.deleteAvatar(actor)).resolves.toBe(result);
    expect(avatarService.delete).toHaveBeenCalledExactlyOnceWith(actor.id);
  });
});
