import { userSelect } from '../users.repository.js';
import { Prisma } from '../../../infra/database/generated/prisma/client.js';

export type UserResponse = Prisma.UserGetPayload<{
  select: typeof userSelect;
}>;
