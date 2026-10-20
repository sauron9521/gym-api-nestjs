import { Prisma } from '../../../generated/prisma/client.js';

export type ViewUserDto = Prisma.UsersGetPayload<{
  omit: { passHash: true };
}>;
