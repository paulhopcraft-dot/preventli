/**
 * Metrics Service
 *
 * Lightweight in-process metrics using ring buffers.
 * No external time-series DB required — suitable for single-instance deployments.
 * Data is visible in the Control Tower at /api/control/performance.
 *
 * Tracked metrics:
 *   - API request durations (per route prefix, last 1000)
 *   - Agent job durations (last 500)
 *   - AI/LLM response latencies (last 500)
 *
 * For multi-instance deployments, replace ring buffers with Redis streams.
 */

// ─── Ring buffer ─────────────────────────────────────────────────────────────

class RingBuffer {
  private buf: number[];
  private pos = 0;
  private filled = false;

  constructor(private readonly capacity: number) {
    this.buf = new Array(capacity).fill(0);
  }

  push(value: number): void {
    this.buf[this.pos] = value;
    this.pos = (this.pos + 1) % this.capacity;
    if (this.pos === 0) this.filled = true;
  }

  /** Values in insertion order */
  values(): number[] {
    if (!this.filled) return this.buf.slice(0, this.pos);
    return [...this.buf.slice(this.pos), ...this.buf.slice(0, this.pos)];
  }

  count(): number {
    return this.filled ? this.capacity : this.pos;
  }

  avg(): number {
    const vals = this.values();
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }

  p95(): number {
    const vals = [...this.values()].sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    const idx = Math.floor(vals.length * 0.95);
    return vals[idx] ?? vals[vals.length - 1];
  }

  max(): number {
    const vals = this.values();
    return vals.length === 0 ? 0 : Math.max(...vals);
  }
}

// ─── Metric stores ────────────────────────────────────────────────────────────

// API request latencies — keyed by route prefix (/api/auth, /api/cases, etc.)
const apiLatencies = new Map<string, RingBuffer>();
const globalApiLatency = new RingBuffer(1000);

// Agent job durations (startedAt → completedAt)
const agentLatency = new RingBuffer(500);
const agentLatencyByType = new Map<string, RingBuffer>();

// AI/LLM call durations
const aiLatency = new RingBuffer(500);

// Counters
let totalRequests = 0;
let totalErrors = 0;

// Process start time
const startedAt = Date.now();

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Record an API request duration.
 * @param routePrefix  e.g. "/api/auth", "/api/cases", "/api/control"
 * @param durationMs   request duration in milliseconds
 * @param isError      true if response was 5xx
 */
export function recordApiRequest(routePrefix: string, durationMs: number, isError = false): void {
  totalRequests++;
  if (isError) totalErrors++;

  globalApiLatency.push(durationMs);

  let buf = apiLatencies.get(routePrefix);
  if (!buf) {
    buf = new RingBuffer(200);
    apiLatencies.set(routePrefix, buf);
  }
  buf.push(durationMs);
}

/**
 * Record a completed agent job duration.
 * @param agentType   coordinator | rtw | recovery | certificate
 * @param durationMs  time from startedAt to completedAt
 */
export function recordAgentJob(agentType: string, durationMs: number): void {
  agentLatency.push(durationMs);

  let buf = agentLatencyByType.get(agentType);
  if (!buf) {
    buf = new RingBuffer(100);
    agentLatencyByType.set(agentType, buf);
  }
  buf.push(durationMs);
}

/**
 * Record an AI/LLM call duration.
 * @param durationMs  time for the LLM API to return a response
 */
export function recordAiCall(durationMs: number): void {
  aiLatency.push(durationMs);
}

// ─── Snapshot for /api/control/performance ──────────────────────────────────

export interface PerformanceSnapshot {
  uptimeMs: number;
  totalRequests: number;
  totalErrors: number;
  errorRatePct: number;
  api: {
    avgLatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
    sampleCount: number;
    byRoute: Record<string, { avg: number; p95: number; count: number }>;
  };
  agents: {
    avgDurationMs: number;
    p95DurationMs: number;
    sampleCount: number;
    byType: Record<string, { avg: number; count: number }>;
  };
  ai: {
    avgLatencyMs: number;
    p95LatencyMs: number;
    sampleCount: number;
  };
}

export function getPerformanceSnapshot(): PerformanceSnapshot {
  const byRoute: Record<string, { avg: number; p95: number; count: number }> = {};
  for (const [route, buf] of Array.from(apiLatencies.entries())) {
    byRoute[route] = { avg: buf.avg(), p95: buf.p95(), count: buf.count() };
  }

  const byType: Record<string, { avg: number; count: number }> = {};
  for (const [type, buf] of Array.from(agentLatencyByType.entries())) {
    byType[type] = { avg: buf.avg(), count: buf.count() };
  }

  const errRate = totalRequests > 0
    ? Math.round((totalErrors / totalRequests) * 1000) / 10
    : 0;

  return {
    uptimeMs: Date.now() - startedAt,
    totalRequests,
    totalErrors,
    errorRatePct: errRate,
    api: {
      avgLatencyMs: globalApiLatency.avg(),
      p95LatencyMs: globalApiLatency.p95(),
      maxLatencyMs: globalApiLatency.max(),
      sampleCount: globalApiLatency.count(),
      byRoute,
    },
    agents: {
      avgDurationMs: agentLatency.avg(),
      p95DurationMs: agentLatency.p95(),
      sampleCount: agentLatency.count(),
      byType,
    },
    ai: {
      avgLatencyMs: aiLatency.avg(),
      p95LatencyMs: aiLatency.p95(),
      sampleCount: aiLatency.count(),
    },
  };
}
