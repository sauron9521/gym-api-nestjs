import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import type { AppConfigService } from '#src/common/config/app-config.types';
import { HttpMetricsController } from './http-metrics.controller.js';
import { HttpMetricsRegistry } from './http-metrics.registry.js';

const TOKEN = 'k'.repeat(43);

function controller(enabled: boolean, secret?: string): HttpMetricsController {
  const config = {
    get(key: string) {
      if (key === 'HTTP_METRICS_ENABLED') return enabled;
      if (key === 'HTTP_METRICS_TOKEN') return secret;
      return undefined;
    },
  } as unknown as AppConfigService;
  return new HttpMetricsController(config, new HttpMetricsRegistry());
}

function request(token: unknown): Request {
  return { headers: { authorization: typeof token === 'string' ? 'Bearer ' + token : token } } as unknown as Request;
}

describe('HttpMetricsController', () => {
  it('is disabled by default, including for requests with a token', () => {
    expect(() => controller(false, TOKEN).metrics(request(TOKEN)))
      .toThrow(NotFoundException);
  });

  it('does not reveal metrics to absent, malformed, or incorrect tokens', () => {
    const endpoint = controller(true, TOKEN);
    for (const input of [undefined, '', 'wrong', ['wrong'], TOKEN + 'x']) {
      expect(() => endpoint.metrics(request(input))).toThrow(NotFoundException);
    }
  });

  it('returns only sanitized Prometheus exposition for a valid token', () => {
    const endpoint = controller(true, TOKEN);
    const text = endpoint.metrics(request(TOKEN));
    expect(text).toContain('gym_api_http_requests_total{status_class="2xx"} 0');
    expect(text).toContain('gym_api_http_request_duration_seconds_bucket{le="+Inf"} 0');
    expect(text).not.toContain(TOKEN);
  });

  it('does not enable an unconfigured scrape endpoint', () => {
    expect(() => controller(true).metrics(request(TOKEN))).toThrow(NotFoundException);
  });
});
