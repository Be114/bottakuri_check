import { afterEach, describe, expect, it, vi } from 'vitest';

import { allowWithinLimit, incrementMetric, metricKey, readMetrics } from '../src/services/kvStore';
import { createMockEnv } from './helpers/mockEnv';

describe('atomic counters', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not allow concurrent increments above the limit', async () => {
    const { env } = createMockEnv();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => allowWithinLimit(env, 'rate:minute:test', 2, 60)),
    );

    expect(results.filter(Boolean)).toHaveLength(2);
    expect(results.filter((allowed) => !allowed)).toHaveLength(8);
  });

  it('resets an expired counter before applying a new limit check', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const { env } = createMockEnv();

    await expect(allowWithinLimit(env, 'rate:day:test', 1, 1)).resolves.toBe(true);
    await expect(allowWithinLimit(env, 'rate:day:test', 1, 1)).resolves.toBe(false);

    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));

    await expect(allowWithinLimit(env, 'rate:day:test', 1, 1)).resolves.toBe(true);
  });

  it('reads metrics from durable counters', async () => {
    const { env } = createMockEnv();
    const day = '2026-01-01';

    await incrementMetric(env, metricKey('requests', day));
    await incrementMetric(env, metricKey('requests', day));
    await incrementMetric(env, metricKey('cache_hits', day));

    await expect(readMetrics(env, day)).resolves.toMatchObject({
      requests: 2,
      cacheHits: 1,
      newAnalysisCount: 0,
      rateLimitedCount: 0,
      budgetExceededCount: 0,
      errorCount: 0,
    });
  });
});
