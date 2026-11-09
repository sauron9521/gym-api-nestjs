import { describe, expect, it } from 'vitest';

import {
  getTrustedProxies,
  isTrustedProxyList,
} from '../proxy.config.js';

describe('trusted proxy configuration', () => {
  it('defaults to no trusted proxy addresses', () => {
    expect(getTrustedProxies()).toEqual([]);
  });

  it('accepts explicit local networks and CIDRs', () => {
    const value = 'loopback,10.0.0.0/8,::1,2001:db8::/48';
    expect(isTrustedProxyList(value)).toBe(true);
    expect(getTrustedProxies(value)).toEqual([
      'loopback', '10.0.0.0/8', '::1', '2001:db8::/48',
    ]);
  });

  it.each([
    '*', 'true', 'false', '0', '1', '0.0.0.0/0',
    '::/0', '10.0.0.0/33', '2001:db8::/129',
    'localhost', 'loopback,', ',loopback', ' ',
    'not-an-address', '10.0.0.0/8;evil',
  ])('rejects permissive or malformed proxy setting %s', (value) => {
    expect(isTrustedProxyList(value)).toBe(false);
  });
});
