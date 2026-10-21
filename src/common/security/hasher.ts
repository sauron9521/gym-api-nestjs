import * as bcrypt from 'bcrypt';
import { config } from '../config/config.js';

export class Hasher {
  public static hash(password: string): Promise<string> {
    const SALT_ON_ROUNDS = config.security.saltRounds;

    return bcrypt.hash(password, SALT_ON_ROUNDS);
  }

  public static async verify(
    password: string,
    hash: string | undefined,
  ): Promise<boolean> {
    try {
      if (!hash) return false;
      return await bcrypt.compare(password, hash);
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}
