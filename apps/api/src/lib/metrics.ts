/** Einfache, prozesslokale Messwerte. Es werden nur tatsächlich erhobene Werte ausgegeben. */
export class Metrics {
  readonly startedAt = Date.now();
  private requests = 0;
  private errors5xx = 0;
  private errors4xx = 0;
  private readonly byRoute = new Map<string, { count: number; errors: number; totalMs: number }>();
  private readonly latencies: number[] = [];
  private readonly window: Array<{ at: number; error: boolean }> = [];

  record(route: string, statusCode: number, ms: number) {
    this.requests++;
    if (statusCode >= 500) this.errors5xx++;
    else if (statusCode >= 400) this.errors4xx++;
    const r = this.byRoute.get(route) ?? { count: 0, errors: 0, totalMs: 0 };
    r.count++;
    r.totalMs += ms;
    if (statusCode >= 500) r.errors++;
    this.byRoute.set(route, r);
    this.latencies.push(ms);
    if (this.latencies.length > 2000) this.latencies.shift();
    const now = Date.now();
    this.window.push({ at: now, error: statusCode >= 500 });
    while (this.window.length && this.window[0]!.at < now - 5 * 60_000) this.window.shift();
  }

  private percentile(p: number) {
    if (!this.latencies.length) return null;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! * 10) / 10;
  }

  snapshot() {
    const recent = this.window.length;
    const recentErrors = this.window.filter((w) => w.error).length;
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      requestsTotal: this.requests,
      errors5xx: this.errors5xx,
      errors4xx: this.errors4xx,
      latencyMs: { p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99), samples: this.latencies.length },
      last5Minutes: { requests: recent, errors5xx: recentErrors, errorRate: recent ? Math.round((recentErrors / recent) * 10000) / 100 : null },
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      topRoutes: [...this.byRoute.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([route, r]) => ({ route, count: r.count, errors: r.errors, avgMs: Math.round((r.totalMs / r.count) * 10) / 10 })),
    };
  }

  /** Prometheus-Textformat für externe Überwachung. */
  prometheus() {
    const s = this.snapshot();
    return [
      '# TYPE enrp_api_requests_total counter',
      `enrp_api_requests_total ${s.requestsTotal}`,
      '# TYPE enrp_api_errors_total counter',
      `enrp_api_errors_total{class="5xx"} ${s.errors5xx}`,
      `enrp_api_errors_total{class="4xx"} ${s.errors4xx}`,
      '# TYPE enrp_api_latency_ms gauge',
      ...(['p50', 'p95', 'p99'] as const).map((p) => `enrp_api_latency_ms{quantile="${p}"} ${s.latencyMs[p] ?? 'NaN'}`),
      '# TYPE enrp_api_uptime_seconds gauge',
      `enrp_api_uptime_seconds ${s.uptimeSeconds}`,
      '',
    ].join('\n');
  }
}
