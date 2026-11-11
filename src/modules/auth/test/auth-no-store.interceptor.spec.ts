import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

import { AuthNoStoreInterceptor } from '../interceptors/auth-no-store.interceptor.js';

describe('AuthNoStoreInterceptor', () => {
  it('marks auth responses as no-store and preserves the handler response', () => {
    const setHeader = vi.fn();
    const response = { setHeader };
    const context = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ExecutionContext;
    const output = of({ authorized: true });
    const handle = vi.fn().mockReturnValue(output);
    const next = { handle } as unknown as CallHandler;

    expect(new AuthNoStoreInterceptor().intercept(context, next)).toBe(output);
    expect(setHeader).toHaveBeenCalledExactlyOnceWith('Cache-Control', 'no-store');
    expect(handle).toHaveBeenCalledOnce();
  });
});
