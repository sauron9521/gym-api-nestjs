import { isIP } from 'node:net';

/**
 * Explicit trusted peer ranges only; never use 'true', '*', or a hop count,
 * because public and private network paths can have different hop counts.
 */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

export function isTrustedProxyList(value: string): boolean {
  const items = value.split(',').map((item) => item.trim());
  return items.length > 0 && items.every((item) => {
    if (!item) return false;
    if (NAMED_RANGES.has(item)) return true;
    if (isIP(item) !== 0) return true;
    const slash = item.lastIndexOf('/');
    if (slash < 0 || item.indexOf('/') !== slash) return false;
    const address = item.slice(0, slash);
    const length = item.slice(slash + 1);
    const family = isIP(address);
    if (family === 0 || !/^(0|[1-9]\d{0,2})$/.test(length)) return false;
    const prefix = Number(length);
    return prefix > 0 && prefix <= (family === 4 ? 32 : 128);
  });
}

export function getTrustedProxies(value?: string): string[] {
  return value ? value.split(',').map((item) => item.trim()) : [];
}
