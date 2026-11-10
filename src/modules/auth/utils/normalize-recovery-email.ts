/**
 * A stable identity key for password recovery; never check account existence
 * when deriving a throttle key. Shared by DTO validation and the guard.
 */
export function normalizeRecoveryEmail(value: string): string {
  return value.trim().normalize('NFC').toLowerCase();
}
