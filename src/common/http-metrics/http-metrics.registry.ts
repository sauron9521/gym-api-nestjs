import { Injectable } from '@nestjs/common';

/**
 * One-process, fixed-cardinality metrics. No URL, method, user, IP, token,
 * request ID, exception text or arbitrary labels are stored or exported.
 *
 * Prometheus counters reset when the Node.js process restarts. Scrapers must
 * use rate()/increase() and must not interpret startup zeros as historical data.
 */
export const HTTP_DURATION_BUCKETS = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);

const HTTP_STATUS_CLASSES = Object.freeze(['1xx', '2xx', '3xx', '4xx', '5xx']);

@Injectable()
export class HttpMetricsRegistry {
  private readonly byStatusClass = [0, 0, 0, 0, 0];
  private readonly durationBuckets = HTTP_DURATION_BUCKETS.map(() => 0);
  private total = 0;
  private totalDurationSeconds = 0;

  /** Called only after a completed HTTP response, never on unfinished sockets. */
  observe(status: number, durationSeconds: number): void {
    if (!Number.isInteger(status) || status < 100 || status > 599 ||
        !Number.isFinite(durationSeconds) || durationSeconds < 0) {
      return;
    }
    const statusIndex = Math.floor(status / 100) - 1;
    this.byStatusClass[statusIndex] = (this.byStatusClass[statusIndex] ?? 0) + 1;
    this.total++;
    this.totalDurationSeconds += durationSeconds;

    for (let index = 0; index < HTTP_DURATION_BUCKETS.length; index++) {
      if (durationSeconds <= HTTP_DURATION_BUCKETS[index]!) {
        this.durationBuckets[index] = (this.durationBuckets[index] ?? 0) + 1;
      }
    }
  }

  /** Render the Prometheus text 0.0.4 exposition format without untrusted data. */
  render(): string {
    const lines = [
      '# HELP gym_api_http_requests_total Completed HTTP responses by status class.',
      '# TYPE gym_api_http_requests_total counter',
    ];
    for (let i = 0; i < HTTP_STATUS_CLASSES.length; i++) {
      lines.push(
        'gym_api_http_requests_total{status_class="' +
        HTTP_STATUS_CLASSES[i] + '"} ' + this.byStatusClass[i],
      );
    }
    lines.push(
      '# HELP gym_api_http_request_duration_seconds Completed HTTP response time in seconds.',
      '# TYPE gym_api_http_request_duration_seconds histogram',
    );
    for (let i = 0; i < HTTP_DURATION_BUCKETS.length; i++) {
      lines.push(
        'gym_api_http_request_duration_seconds_bucket{le="' +
        HTTP_DURATION_BUCKETS[i] + '"} ' + this.durationBuckets[i],
      );
    }
    lines.push(
      'gym_api_http_request_duration_seconds_bucket{le="+Inf"} ' + this.total,
      'gym_api_http_request_duration_seconds_sum ' + this.totalDurationSeconds,
      'gym_api_http_request_duration_seconds_count ' + this.total,
      '',
    );
    return lines.join('\n');
  }
}
