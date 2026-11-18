// Контроль нагрузки, мониторинг и трассировка.
// Лёгкий реестр метрик (счётчики + гистограмма задержек) и генерация trace-id.

import { randomUUID } from 'node:crypto';

const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500]; // мс

export function createMetrics() {
  const startedAt = Date.now();
  const counters = new Map(); // key -> number
  const latencies = new Map(); // key -> { count, sum, max, buckets: number[] }

  const bump = (key, by = 1) => counters.set(key, (counters.get(key) || 0) + by);

  return {
    counter(key, by = 1) {
      bump(key, by);
    },
    observe(key, ms) {
      let h = latencies.get(key);
      if (!h) {
        h = { count: 0, sum: 0, max: 0, buckets: new Array(BUCKETS.length + 1).fill(0) };
        latencies.set(key, h);
      }
      h.count++;
      h.sum += ms;
      if (ms > h.max) h.max = ms;
      let i = BUCKETS.findIndex((b) => ms <= b);
      if (i === -1) i = BUCKETS.length;
      h.buckets[i]++;
    },
    snapshot() {
      const out = { uptimeSec: Math.round((Date.now() - startedAt) / 1000), counters: {}, latency: {} };
      for (const [k, v] of counters) out.counters[k] = v;
      for (const [k, h] of latencies) {
        out.latency[k] = {
          count: h.count,
          avgMs: h.count ? Number((h.sum / h.count).toFixed(2)) : 0,
          maxMs: Number(h.max.toFixed(2)),
          buckets: BUCKETS.map((b, i) => ({ le: b, count: h.buckets.slice(0, i + 1).reduce((a, c) => a + c, 0) })),
          inf: h.buckets[BUCKETS.length],
        };
      }
      return out;
    },
  };
}

export const newTraceId = () => randomUUID();
