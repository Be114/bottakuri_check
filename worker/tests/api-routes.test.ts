import { describe, expect, it } from 'vitest';

import worker from '../src/index';
import { formatDayInTimeZone, resolveDayRolloverTimezone } from '../src/utils/time';
import { createMockEnv } from './helpers/mockEnv';

describe('worker API routes', () => {
  it('GET /api/health returns ok payload', async () => {
    const { env } = createMockEnv();
    const request = new Request('https://example.com/api/health', {
      method: 'GET',
      headers: { Origin: 'http://localhost:3000' },
    });

    const response = await worker.fetch(request, env);
    const payload = (await response.json()) as { status: string; model: string; metrics: { cacheHitRate: number } };

    expect(response.status).toBe(200);
    expect(payload.status).toBe('ok');
    expect(payload.model).toBe('google/gemini-3-flash-preview');
    expect(payload.metrics.cacheHitRate).toBeTypeOf('number');
  });

  it('POST /api/analyze returns INVALID_QUERY for too-short query', async () => {
    const { env } = createMockEnv();
    const request = new Request('https://example.com/api/analyze', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'a' }),
    });

    const response = await worker.fetch(request, env);
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_QUERY');
  });

  it('POST /api/analyze returns RATE_LIMIT when per-minute limit is exceeded', async () => {
    const { env } = createMockEnv({ PER_MINUTE_LIMIT: '0' });
    const request = new Request('https://example.com/api/analyze', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '新宿' }),
    });

    const response = await worker.fetch(request, env);
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe('RATE_LIMIT');
  });

  it('POST /api/analyze returns BUDGET_EXCEEDED when daily budget slots are exhausted', async () => {
    const { env, kv } = createMockEnv({
      DAILY_BUDGET_USD: '1',
      WORST_CASE_COST_USD: '1',
    });

    const day = formatDayInTimeZone(new Date(), resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE));
    kv.seed(`budget:new:${day}`, '1');

    const request = new Request('https://example.com/api/analyze', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '新宿' }),
    });

    const response = await worker.fetch(request, env);
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe('BUDGET_EXCEEDED');
  });
});
