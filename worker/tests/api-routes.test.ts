import { describe, expect, it } from 'vitest';

import worker from '../src/index';
import { AnalysisReport } from '../src/types';
import { buildCacheKey } from '../src/utils/hash';
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
    const payload = (await response.json()) as {
      status: string;
      model: string;
      metrics: { cacheHitRate: number; errorCount: number };
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe('ok');
    expect(payload.model).toBe('google/gemini-3-flash-preview');
    expect(payload.metrics.cacheHitRate).toBeTypeOf('number');
    expect(payload.metrics.errorCount).toBe(0);
    expect(response.headers.get('x-request-id')).toBeTypeOf('string');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
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
    const payload = (await response.json()) as { error: { code: string; requestId?: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_QUERY');
    expect(payload.error.requestId).toBeTypeOf('string');
    expect(response.headers.get('x-request-id')).toBeTypeOf('string');
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
    const payload = (await response.json()) as { error: { code: string; requestId?: string } };

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe('RATE_LIMIT');
    expect(payload.error.requestId).toBeTypeOf('string');
  });

  it('POST /api/analyze returns cached analysis without spending new-analysis budget', async () => {
    const { env, kv } = createMockEnv({
      DAILY_BUDGET_USD: '1',
      WORST_CASE_COST_USD: '1',
    });
    const cachedReport = buildCachedReport();
    kv.seed(await buildCacheKey('新宿', undefined), JSON.stringify(cachedReport));

    const request = new Request('https://example.com/api/analyze', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '新宿' }),
    });

    const response = await worker.fetch(request, env);
    const payload = (await response.json()) as AnalysisReport;
    const day = formatDayInTimeZone(new Date(), resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE));
    const healthResponse = await worker.fetch(
      new Request('https://example.com/api/health', {
        method: 'GET',
        headers: { Origin: 'http://localhost:3000' },
      }),
      env,
    );
    const healthPayload = (await healthResponse.json()) as {
      metrics: { cacheHits: number; newAnalysisCount: number };
      dayRolloverTimezone: string;
    };

    expect(response.status).toBe(200);
    expect(payload.placeName).toBe(cachedReport.placeName);
    expect(payload.meta.cached).toBe(true);
    expect(payload.meta.budgetState).toBe('ok');
    expect(day).toBeTypeOf('string');
    expect(healthPayload.metrics.cacheHits).toBe(1);
    expect(healthPayload.metrics.newAnalysisCount).toBe(0);
  });

  it('POST /api/analyze returns BUDGET_EXCEEDED when daily budget slots are exhausted', async () => {
    const { env, counters } = createMockEnv({
      DAILY_BUDGET_USD: '1',
      WORST_CASE_COST_USD: '1',
    });

    const day = formatDayInTimeZone(new Date(), resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE));
    await counters.seed(`budget:new:${day}`, 1);

    const request = new Request('https://example.com/api/analyze', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '新宿' }),
    });

    const response = await worker.fetch(request, env);
    const payload = (await response.json()) as { error: { code: string; requestId?: string } };

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe('BUDGET_EXCEEDED');
    expect(payload.error.requestId).toBeTypeOf('string');
  });
});

function buildCachedReport(): AnalysisReport {
  return {
    placeName: 'キャッシュ店舗',
    address: '東京都新宿区',
    sakuraScore: 20,
    estimatedRealRating: 3.8,
    googleRating: 3.9,
    verdict: '安全',
    risks: [{ category: '総合', riskLevel: 'low', description: '目立ったリスクはありません。' }],
    suspiciousKeywordsFound: [],
    summary: 'キャッシュ済みの分析結果です。',
    reviewDistribution: [
      { star: 1, percentage: 5 },
      { star: 2, percentage: 10 },
      { star: 3, percentage: 20 },
      { star: 4, percentage: 35 },
      { star: 5, percentage: 30 },
    ],
    groundingUrls: [{ title: 'Google Maps', uri: 'https://www.google.com/maps/place/?q=place_id:place-id' }],
    meta: {
      cached: false,
      model: 'google/gemini-3-flash-preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      budgetState: 'ok',
    },
  };
}
