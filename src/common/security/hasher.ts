import * as bcrypt from 'bcrypt';
import { config } from '../config/config.js';

export class Hasher {
  public static hash(password: string): Promise<string> {
    const SALT_ON_ROUNDS = config.security.saltRounds;

    return bcrypt.hash(password, SALT_ON_ROUNDS);
  }

  public static async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await bcrypt.compare(hash, password);
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}
