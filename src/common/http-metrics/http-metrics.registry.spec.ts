import { describe, expect, it } from 'vitest';

import { HTTP_DURATION_BUCKETS, HttpMetricsRegistry } from './http-metrics.registry.js';

function findValue(metrics: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = metrics.match(new RegExp('^' + escaped + ' ([0-9]+(?:\\.[0-9]+)?)$', 'm'));
  if (!match) throw new Error('Missing sample: ' + name);
  return Number(match[1]);
}

describe('HttpMetricsRegistry', () => {
  it('exports fixed bounded counters and cumulative Prometheus histogram', () => {
    const registry = new HttpMetricsRegistry();
    registry.observe(200, 0.004);
    registry.observe(302, 0.02);
    registry.observe(400, 0.09);
    registry.observe(429, 0.12);
    registry.observe(503, 2.7);
    const metrics = registry.render();

    expect(metrics).toContain('# TYPE gym_api_http_requests_total counter');
    expect(metrics).toContain('# TYPE gym_api_http_request_duration_seconds histogram');
    for (const [label, value] of [
      ['1xx', 0], ['2xx', 1], ['3xx', 1], ['4xx', 2], ['5xx', 1],
    ] as const) {
      expect(findValue(metrics, 'gym_api_http_requests_total{status_class="' + label + '"}'))
        .toBe(value);
    }
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_bucket{le="0.005"}'))
      .toBe(1);
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_bucket{le="0.025"}'))
      .toBe(2);
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_bucket{le="0.1"}'))
      .toBe(3);
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_bucket{le="+Inf"}'))
      .toBe(5);
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_count'))
      .toBe(5);
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_sum'))
      .toBeCloseTo(2.934);
    expect(HTTP_DURATION_BUCKETS).toHaveLength(11);

    // No client-specific dimensions or free-form request information.
    expect(metrics).not.toMatch(/method=|route=|path=|user=|token|secret|email|ip=/i);
    expect(metrics).not.toContain('Bearer');
  });

  it('ignores invalid observations and keeps counters monotonic', () => {
    const registry = new HttpMetricsRegistry();
    for (const [status, duration] of [
      [99, 0.2], [600, 0.2], [200, -1], [401, NaN],
      [401, Infinity], [200.5, 1],
    ]) registry.observe(status, duration);
    expect(findValue(registry.render(),
      'gym_api_http_request_duration_seconds_count')).toBe(0);
    registry.observe(401, 0);
    registry.observe(201, 15);
    const metrics = registry.render();
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_count')).toBe(2);
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_bucket{le="10"}'))
      .toBe(1);
    expect(findValue(metrics, 'gym_api_http_request_duration_seconds_bucket{le="+Inf"}'))
      .toBe(2);
  });

  it('does not allocate new label keys or retain requests across observations', () => {
    const registry = new HttpMetricsRegistry();
    for (let i = 0; i < 1000; i++) {
      registry.observe(200 + (i % 5), 0.01);
    }
    const metrics = registry.render();
    expect(metrics.match(/^gym_api_http_requests_total\{/gm)).toHaveLength(5);
    expect(metrics.match(/^gym_api_http_request_duration_seconds_bucket\{/gm))
      .toHaveLength(HTTP_DURATION_BUCKETS.length + 1);
    expect(findValue(metrics,
      'gym_api_http_request_duration_seconds_count')).toBe(1000);
  });
});
