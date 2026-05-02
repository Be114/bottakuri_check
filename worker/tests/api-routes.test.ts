import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import { AnalysisReport, NearbyRankingsResponse } from '../src/types';
import { buildCacheKey, buildNearbyCacheKey, hashIp } from '../src/utils/hash';
import { formatDayInTimeZone, resolveDayRolloverTimezone } from '../src/utils/time';
import { createMockEnv } from './helpers/mockEnv';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(payload.model).toBe('google/gemini-3.1-flash-lite-preview');
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

  it('POST /api/analyze includes Google Places genre and categories', async () => {
    const { env } = createMockEnv();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('places:searchText')) {
        const body = JSON.parse(String(init?.body || '{}')) as { textQuery?: string };
        return Response.json({
          places: [
            {
              id: 'ichiran-origin',
              displayName: { text: body.textQuery || '一蘭 新宿中央東口店' },
              primaryType: 'ramen_restaurant',
              primaryTypeDisplayName: { text: 'ラーメン店' },
              types: ['ramen_restaurant', 'restaurant', 'food'],
              formattedAddress: '東京都新宿区',
              rating: 4.1,
              userRatingCount: 1200,
              location: { latitude: 35.6901, longitude: 139.7021 },
            },
          ],
        });
      }
      if (url.includes('places.googleapis.com/v1/places/ichiran-origin')) {
        return Response.json(
          buildDetailsPlace('ichiran-origin', '一蘭 新宿中央東口店', 'ramen_restaurant', 'ラーメン店'),
        );
      }
      if (url.includes('openrouter.ai')) {
        return Response.json({
          choices: [{ message: { content: JSON.stringify(buildAnalysisPayload('一蘭 新宿中央東口店', 20)) } }],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://example.com/api/analyze', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '一蘭 新宿中央東口店', location: { lat: 35.6901, lng: 139.7021 } }),
      }),
      env,
    );
    const payload = (await response.json()) as AnalysisReport;

    expect(response.status).toBe(200);
    expect(payload.genre).toBe('ラーメン店');
    expect(payload.categories).toEqual(expect.arrayContaining(['ramen_restaurant']));
    expect(payload.metadata?.genre).toBe('ラーメン店');
    expect(payload.metadata?.categories).toEqual(expect.arrayContaining(['ramen_restaurant']));
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

  it('POST /api/analyze ignores exhausted legacy and nearby daily counters', async () => {
    const { env, counters } = createMockEnv({
      PER_DAY_NEW_ANALYSIS_LIMIT: '1',
      DAILY_BUDGET_USD: '100',
      WORST_CASE_COST_USD: '1',
    });
    const day = formatDayInTimeZone(new Date(), resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE));
    const ipHash = await hashIp('unknown');
    await counters.seed(`rate:day:${ipHash}:${day}`, 1);
    await counters.seed(`rate:day:nearby:${ipHash}:${day}`, 1000);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('places:searchText')) {
        const body = JSON.parse(String(init?.body || '{}')) as { textQuery?: string };
        return Response.json({
          places: [
            {
              id: 'counter-test-place',
              displayName: { text: body.textQuery || '分析店' },
              primaryType: 'ramen_restaurant',
              primaryTypeDisplayName: { text: 'ラーメン店' },
              types: ['ramen_restaurant', 'restaurant', 'food'],
              formattedAddress: '東京都新宿区',
              rating: 4.1,
              userRatingCount: 200,
              location: { latitude: 35.69, longitude: 139.7 },
            },
          ],
        });
      }
      if (url.includes('places.googleapis.com/v1/places/counter-test-place')) {
        return Response.json(buildDetailsPlace('counter-test-place', '分析店', 'ramen_restaurant', 'ラーメン店'));
      }
      if (url.includes('openrouter.ai')) {
        return Response.json({
          choices: [{ message: { content: JSON.stringify(buildAnalysisPayload('分析店', 18)) } }],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://example.com/api/analyze', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '分析店', location: { lat: 35.69, lng: 139.7 } }),
      }),
      env,
    );
    const payload = (await response.json()) as AnalysisReport;

    expect(response.status).toBe(200);
    expect(payload.placeName).toBe('分析店');
    expect(payload.meta.cached).toBe(false);
  });

  it('POST /api/nearby-rankings filters to the same genre and returns about 10 analyzed places', async () => {
    const { env } = createMockEnv();
    const nearbyPlaces = [
      ...Array.from({ length: 10 }, (_, index) =>
        buildNearbyPlace(
          `ramen-${index + 1}`,
          `ラーメン店${index + 1}`,
          35.6813 + index * 0.0001,
          139.7672 + index * 0.0001,
          4.6 - index * 0.03,
          180 - index,
          'ramen_restaurant',
          ['restaurant', 'food', 'ramen_restaurant'],
        ),
      ),
      buildNearbyPlace('cafe-1', 'カフェ店', 35.6828, 139.7688, 4.7, 120, 'cafe', ['cafe', 'food']),
      buildNearbyPlace('hotel-1', 'ホテル', 35.6815, 139.7674, 4.3, 440, 'hotel', ['hotel', 'restaurant']),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('places:searchNearby')) {
        return Response.json({ places: nearbyPlaces });
      }
      if (url.includes('places.googleapis.com/v1/places/')) {
        const placeId = decodeURIComponent(url.split('/places/')[1].split('?')[0]);
        const place = nearbyPlaces.find((candidate) => candidate.id === placeId);
        return Response.json(
          buildDetailsPlace(placeId, String(place?.displayName && (place.displayName as { text: string }).text)),
        );
      }
      if (url.includes('openrouter.ai')) {
        const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ content?: string }> };
        const prompt = body.messages?.find((message) => message.content?.includes('店舗名:'))?.content || '';
        const placeName = prompt.match(/店舗名: (.+)/)?.[1]?.split('\n')[0] || '分析店';
        const index = Number(placeName.match(/\d+/)?.[0] || '1');
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify(buildAnalysisPayload(placeName, 10 + index)),
              },
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://example.com/api/nearby-rankings', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originPlaceName: '東京駅',
          originAddress: '東京都千代田区',
          originGenre: 'ラーメン',
          originCategories: ['ramen_restaurant'],
          location: { lat: 35.681236, lng: 139.767125 },
          radiusMeters: 700,
        }),
      }),
      env,
    );
    const payload = (await response.json()) as NearbyRankingsResponse;
    const nearbyCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes('places:searchNearby');
    });
    const nearbyRequest = JSON.parse(String(nearbyCall?.[1]?.body)) as {
      includedTypes?: string[];
      includedPrimaryTypes?: string[];
    };
    const nearbyHeaders = new Headers(nearbyCall?.[1]?.headers);

    expect(response.status).toBe(200);
    expect(nearbyRequest.includedTypes).toBeUndefined();
    expect(nearbyRequest.includedPrimaryTypes).toEqual(['ramen_restaurant']);
    expect(nearbyHeaders.get('X-Goog-FieldMask')).toContain('places.primaryType');
    expect(nearbyHeaders.get('X-Goog-FieldMask')).toContain('places.types');
    expect(nearbyHeaders.get('X-Goog-FieldMask')).toContain('places.priceLevel');
    expect(nearbyHeaders.get('X-Goog-FieldMask')).toContain('places.priceRange');
    expect(payload.origin.placeName).toBe('東京駅');
    expect(payload.origin.genre).toBe('ラーメン');
    expect(payload.rankings).toHaveLength(10);
    expect(payload.rankings.every((ranking) => ranking.categories.includes('ramen_restaurant'))).toBe(true);
    expect(payload.rankings[0].priceLevel).toBe('PRICE_LEVEL_MODERATE');
    expect(payload.rankings[0].priceRange?.startPrice?.currencyCode).toBe('JPY');
    expect(payload.rankings.map((ranking) => ranking.placeName)).not.toContain('カフェ店');
    expect(payload.rankings.map((ranking) => ranking.placeName)).not.toContain('ホテル');
    expect(payload.rankings[0].trustScore).toBeGreaterThanOrEqual(payload.rankings[1].trustScore);
    expect(payload.topPins).toHaveLength(3);
    expect(payload.mapImageUrl).toContain('/api/nearby-map?');
    expect(payload.mapImageUrl).not.toContain('key=');
    expect(payload.mapEmbedUrl).toBe('https://www.google.com/maps?q=35.681236%2C139.767125&z=15&output=embed');
    expect(payload.mapEmbedUrl).not.toContain('key=');
    expect(new URL(payload.topPins[0].mapUrl).searchParams.get('query_place_id')).toMatch(/^ramen-/);
    expect(new URL(payload.topPins[0].mapUrl).searchParams.get('query')).toContain('35.');
    expect(payload.topPins[0].analysisReport?.placeName).toContain('ラーメン店');
    expect(payload.meta.cached).toBe(false);
    expect(payload.meta.analyzedCount).toBe(10);
    expect(payload.meta.genreFilter).toEqual(['ramen_restaurant']);
    expect(payload.meta.warnings).toEqual([]);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('openrouter.ai'))).toHaveLength(10);

    fetchMock.mockClear();
    const cachedAnalysisResponse = await worker.fetch(
      new Request('https://example.com/api/analyze', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: payload.topPins[0].placeName,
          location: payload.topPins[0].location,
        }),
      }),
      env,
    );
    const cachedAnalysis = (await cachedAnalysisResponse.json()) as AnalysisReport;
    expect(cachedAnalysisResponse.status).toBe(200);
    expect(cachedAnalysis.meta.cached).toBe(true);
    expect(cachedAnalysis.placeName).toBe(payload.topPins[0].placeName);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/nearby-rankings resolves Ichiran origin genre and excludes fast food, sushi, and udon', async () => {
    const { env } = createMockEnv();
    const firstRadiusPlaces = [
      buildNearbyPlace('ramen-1', '風雲児', 35.688, 139.7, 4.4, 900, 'ramen_restaurant', [
        'ramen_restaurant',
        'restaurant',
        'food',
      ]),
      buildNearbyPlace('fast-food-1', 'マクドナルド JR新宿南口店', 35.689, 139.701, 3.8, 1500, 'fast_food_restaurant', [
        'fast_food_restaurant',
        'restaurant',
        'food',
      ]),
      buildNearbyPlace('sushi-1', 'スシロー 新宿東口店', 35.69, 139.702, 4.0, 1200, 'sushi_restaurant', [
        'sushi_restaurant',
        'restaurant',
        'food',
      ]),
      buildNearbyPlace('udon-1', 'うどん 慎', 35.691, 139.703, 4.5, 1800, 'japanese_restaurant', [
        'japanese_restaurant',
        'restaurant',
        'food',
      ]),
    ];
    const expandedRadiusPlaces = [
      ...firstRadiusPlaces,
      ...Array.from({ length: 9 }, (_, index) =>
        buildNearbyPlace(
          `ramen-expanded-${index + 2}`,
          `ラーメン候補${index + 2}`,
          35.692 + index * 0.0001,
          139.704 + index * 0.0001,
          4.2,
          300 + index,
          'ramen_restaurant',
          ['ramen_restaurant', 'restaurant', 'food'],
        ),
      ),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('places:searchText')) {
        return Response.json({
          places: [
            {
              id: 'ichiran-origin',
              displayName: { text: '一蘭 新宿中央東口店' },
              primaryType: 'ramen_restaurant',
              primaryTypeDisplayName: { text: 'ラーメン店' },
              types: ['ramen_restaurant', 'restaurant', 'food'],
              formattedAddress: '東京都新宿区',
              rating: 4.1,
              userRatingCount: 1200,
              location: { latitude: 35.6901, longitude: 139.7021 },
            },
          ],
        });
      }
      if (url.includes('places.googleapis.com/v1/places/ichiran-origin')) {
        return Response.json(
          buildDetailsPlace('ichiran-origin', '一蘭 新宿中央東口店', 'ramen_restaurant', 'ラーメン店'),
        );
      }
      if (url.includes('places:searchNearby')) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          includedPrimaryTypes?: string[];
          locationRestriction?: { circle?: { radius?: number } };
        };
        expect(body.includedPrimaryTypes).toEqual(['ramen_restaurant']);
        const radius = Number(body.locationRestriction?.circle?.radius || 0);
        return Response.json({ places: radius < 1200 ? firstRadiusPlaces : expandedRadiusPlaces });
      }
      if (url.includes('places.googleapis.com/v1/places/')) {
        const placeId = decodeURIComponent(url.split('/places/')[1].split('?')[0]);
        const place = expandedRadiusPlaces.find((candidate) => candidate.id === placeId);
        return Response.json(
          buildDetailsPlace(
            placeId,
            String(place?.displayName && (place.displayName as { text: string }).text),
            'ramen_restaurant',
            'ラーメン店',
          ),
        );
      }
      if (url.includes('openrouter.ai')) {
        const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ content?: string }> };
        const prompt = body.messages?.find((message) => message.content?.includes('店舗名:'))?.content || '';
        const placeName = prompt.match(/店舗名: (.+)/)?.[1]?.split('\n')[0] || 'ラーメン候補';
        return Response.json({
          choices: [{ message: { content: JSON.stringify(buildAnalysisPayload(placeName, 16)) } }],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://example.com/api/nearby-rankings', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originPlaceName: '一蘭 新宿中央東口店',
          originAddress: '東京都新宿区',
          location: { lat: 35.6901, lng: 139.7021 },
          radiusMeters: 800,
        }),
      }),
      env,
    );
    const payload = (await response.json()) as NearbyRankingsResponse;
    const names = payload.rankings.map((ranking) => ranking.placeName);

    expect(response.status).toBe(200);
    expect(payload.origin.genre).toBe('ラーメン店');
    expect(payload.origin.categories).toEqual(expect.arrayContaining(['ramen_restaurant']));
    expect(payload.rankings).toHaveLength(10);
    expect(payload.rankings.every((ranking) => ranking.categories.includes('ramen_restaurant'))).toBe(true);
    expect(names).not.toContain('マクドナルド JR新宿南口店');
    expect(names).not.toContain('スシロー 新宿東口店');
    expect(names).not.toContain('うどん 慎');
    expect(payload.meta.genreFilter).toEqual(['ramen_restaurant']);
    expect(payload.meta.warnings.join('\n')).toContain('半径を1200mまで拡大');
  });

  it('POST /api/nearby-rankings returns partial success when one per-place analysis fails', async () => {
    const { env } = createMockEnv();
    const nearbyPlaces = [
      buildNearbyPlace('ramen-ok-1', '成功店1', 35.6813, 139.7672, 4.4, 160, 'ramen_restaurant', [
        'restaurant',
        'ramen_restaurant',
      ]),
      buildNearbyPlace('ramen-fail', '失敗店', 35.6814, 139.7673, 4.8, 8, 'ramen_restaurant', [
        'restaurant',
        'ramen_restaurant',
      ]),
      buildNearbyPlace('ramen-ok-2', '成功店2', 35.6815, 139.7674, 4.1, 90, 'ramen_restaurant', [
        'restaurant',
        'ramen_restaurant',
      ]),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('places:searchNearby')) {
        return Response.json({ places: nearbyPlaces });
      }
      if (url.includes('places.googleapis.com/v1/places/')) {
        const placeId = decodeURIComponent(url.split('/places/')[1].split('?')[0]);
        const place = nearbyPlaces.find((candidate) => candidate.id === placeId);
        return Response.json(
          buildDetailsPlace(placeId, String(place?.displayName && (place.displayName as { text: string }).text)),
        );
      }
      if (url.includes('openrouter.ai')) {
        const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ content?: string }> };
        const prompt = body.messages?.find((message) => message.content?.includes('店舗名:'))?.content || '';
        const placeName = prompt.match(/店舗名: (.+)/)?.[1]?.split('\n')[0] || '分析店';
        if (placeName.includes('失敗店')) {
          return Response.json({ error: { message: 'model unavailable' } }, { status: 503 });
        }
        return Response.json({
          choices: [{ message: { content: JSON.stringify(buildAnalysisPayload(placeName, 18)) } }],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://example.com/api/nearby-rankings', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originPlaceName: '起点ラーメン',
          originGenre: 'ラーメン',
          location: { lat: 35.681236, lng: 139.767125 },
        }),
      }),
      env,
    );
    const payload = (await response.json()) as NearbyRankingsResponse;
    const failed = payload.rankings.find((ranking) => ranking.placeId === 'ramen-fail');

    expect(response.status).toBe(200);
    expect(payload.rankings).toHaveLength(3);
    expect(payload.meta.analyzedCount).toBe(2);
    expect(payload.meta.warnings.join('\n')).toContain('失敗店のAI分析に失敗');
    expect(failed?.analysisReport).toBeUndefined();
    expect(failed?.trustScore).toBeTypeOf('number');
    expect(new URL(failed?.mapUrl || '').searchParams.get('query_place_id')).toBe('ramen-fail');
  });

  it('POST /api/nearby-rankings returns cached rankings without upstream calls', async () => {
    const { env, kv } = createMockEnv({
      DAILY_BUDGET_USD: '1',
      WORST_CASE_COST_USD: '1',
    });
    const location = { lat: 35.681236, lng: 139.767125 };
    const cached = buildCachedNearbyResponse(location);
    kv.seed(await buildNearbyCacheKey(location, 800, 'ramen_restaurant'), JSON.stringify(cached));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://example.com/api/nearby-rankings', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originPlaceName: '東京駅',
          originGenre: 'ラーメン',
          originCategories: ['ramen_restaurant'],
          location,
        }),
      }),
      env,
    );
    const payload = (await response.json()) as NearbyRankingsResponse;

    expect(response.status).toBe(200);
    expect(payload.meta.cached).toBe(true);
    expect(payload.rankings[0].placeName).toBe('キャッシュ店');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/nearby-rankings returns INVALID_QUERY for missing location', async () => {
    const { env } = createMockEnv();
    const response = await worker.fetch(
      new Request('https://example.com/api/nearby-rankings', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ originPlaceName: '東京駅' }),
      }),
      env,
    );
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_QUERY');
  });

  it('GET /api/nearby-map proxies Google Static Maps without exposing the API key', async () => {
    const { env } = createMockEnv();
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const upstream = new URL(url);
      expect(upstream.origin + upstream.pathname).toBe('https://maps.googleapis.com/maps/api/staticmap');
      expect(upstream.searchParams.get('key')).toBe(env.GOOGLE_PLACES_API_KEY);
      expect(upstream.searchParams.getAll('markers')).toEqual(
        expect.arrayContaining([
          'color:red|label:S|35.69,139.702',
          'color:blue|label:1|35.691,139.703',
          'color:blue|label:2|35.692,139.704',
          'color:blue|label:3|35.693,139.705',
        ]),
      );
      return new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request(
        'https://example.com/api/nearby-map?originLat=35.69&originLng=139.702&pins=1,35.691,139.703|2,35.692,139.704|3,35.693,139.705',
        {
          method: 'GET',
          headers: { Origin: 'http://localhost:3000' },
        },
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('image/png');
    expect(response.headers.get('Cache-Control')).toContain('max-age=300');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.url).not.toContain(env.GOOGLE_PLACES_API_KEY);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);
  });

  it('GET /api/nearby-map returns safe upstream diagnostics when Google Static Maps fails', async () => {
    const { env } = createMockEnv();
    const fetchMock = vi.fn(
      async () =>
        new Response(`REQUEST_DENIED key=${env.GOOGLE_PLACES_API_KEY}`, {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'Content-Type': 'text/plain' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://example.com/api/nearby-map?originLat=35.69&originLng=139.702&pins=1,35.691,139.703', {
        method: 'GET',
        headers: { Origin: 'http://localhost:3000' },
      }),
      env,
    );
    const payload = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(502);
    expect(payload.error.message).toContain('upstreamStatus=403');
    expect(payload.error.message).toContain('REQUEST_DENIED');
    expect(payload.error.message).not.toContain(env.GOOGLE_PLACES_API_KEY);
    expect(payload.error.message).toContain('key=REDACTED');
  });
});

function buildCachedReport(): AnalysisReport {
  return {
    placeName: 'キャッシュ店舗',
    address: '東京都新宿区',
    genre: 'ラーメン店',
    category: 'ラーメン店',
    categories: ['ラーメン店', 'ramen_restaurant', 'restaurant'],
    metadata: {
      genre: 'ラーメン店',
      category: 'ラーメン店',
      categories: ['ラーメン店', 'ramen_restaurant', 'restaurant'],
      primaryType: 'ramen_restaurant',
      types: ['ramen_restaurant', 'restaurant'],
      placeId: 'cached-place-id',
    },
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
      model: 'google/gemini-3.1-flash-lite-preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      budgetState: 'ok',
    },
  };
}

function buildNearbyPlace(
  placeId: string,
  name: string,
  lat: number,
  lng: number,
  rating: number,
  userRatingCount: number,
  primaryType = 'restaurant',
  types = ['restaurant'],
): Record<string, unknown> {
  return {
    id: placeId,
    displayName: { text: name },
    primaryType,
    primaryTypeDisplayName: { text: primaryType === 'restaurant' ? 'レストラン' : primaryType },
    types,
    formattedAddress: `東京都 ${name}`,
    rating,
    userRatingCount,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    priceRange: {
      startPrice: { currencyCode: 'JPY', units: '1000' },
      endPrice: { currencyCode: 'JPY', units: '2000' },
    },
    location: { latitude: lat, longitude: lng },
  };
}

function buildDetailsPlace(
  placeId: string,
  name: string,
  primaryType = 'ramen_restaurant',
  primaryTypeDisplayName = 'ラーメン店',
): Record<string, unknown> {
  return {
    id: placeId,
    displayName: { text: name },
    primaryType,
    primaryTypeDisplayName: { text: primaryTypeDisplayName },
    types: [primaryType, 'restaurant', 'food'],
    formattedAddress: `東京都 ${name}`,
    rating: 4.2,
    userRatingCount: 120,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    priceRange: {
      startPrice: { currencyCode: 'JPY', units: '1000' },
      endPrice: { currencyCode: 'JPY', units: '2000' },
    },
    location: { latitude: 35.6813, longitude: 139.7672 },
    reviews: [
      {
        rating: 4,
        text: { text: '味と接客のバランスが良く、普段使いしやすいです。' },
        publishTime: '2026-04-01T00:00:00Z',
        authorAttribution: { displayName: 'reviewer' },
      },
    ],
  };
}

function buildAnalysisPayload(placeName: string, sakuraScore: number): Record<string, unknown> {
  return {
    placeName,
    address: `東京都 ${placeName}`,
    sakuraScore,
    estimatedRealRating: 4.1,
    googleRating: 4.2,
    tabelogRating: null,
    verdict: sakuraScore >= 70 ? '危険' : sakuraScore >= 40 ? '注意' : '安全',
    risks: [
      {
        category: 'レビュー整合性',
        riskLevel: sakuraScore >= 40 ? 'medium' : 'low',
        description: 'レビュー件数と評価のバランスに大きな不自然さはありません。',
      },
    ],
    suspiciousKeywordsFound: [],
    summary: `${placeName}はレビュー傾向が安定しています。`,
    reviewDistribution: [
      { star: 1, percentage: 5 },
      { star: 2, percentage: 8 },
      { star: 3, percentage: 22 },
      { star: 4, percentage: 35 },
      { star: 5, percentage: 30 },
    ],
  };
}

function buildCachedNearbyResponse(location: { lat: number; lng: number }): NearbyRankingsResponse {
  return {
    origin: {
      placeName: '古い起点名',
      location,
      radiusMeters: 800,
    },
    rankings: [
      {
        rank: 1,
        placeId: 'cached-place',
        name: 'キャッシュ店',
        genre: 'レストラン',
        placeName: 'キャッシュ店',
        address: '東京都',
        location,
        distanceMeters: 20,
        googleRating: 4.1,
        userRatingCount: 100,
        estimatedRealRating: 3.9,
        trustScore: 80,
        sakuraScore: 20,
        suspicionLevel: 'low',
        verdict: '安全',
        summary: 'キャッシュ済み',
        reasons: ['キャッシュ'],
        categories: ['restaurant'],
        mapUrl: 'https://www.google.com/maps/place/?q=place_id:cached-place',
      },
    ],
    topPins: [],
    mapEmbedUrl: 'https://www.google.com/maps?q=35.681236%2C139.767125&z=15&output=embed',
    meta: {
      cached: false,
      model: 'google/gemini-3.1-flash-lite-preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      budgetState: 'ok',
      candidatesCount: 1,
      analyzedCount: 1,
      warnings: [],
    },
  };
}
