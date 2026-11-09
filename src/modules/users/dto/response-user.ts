import { userSelect } from '../users.repository.js';
import { Prisma } from '#prisma/client';

export type UserResponse = Prisma.UserGetPayload<{
  select: typeof userSelect;
}>;
