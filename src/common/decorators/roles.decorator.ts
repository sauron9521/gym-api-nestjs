import { SetMetadata } from '@nestjs/common';
import { Role } from '../../infra/database/generated/prisma/client.js';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
