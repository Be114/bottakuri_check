import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyzeNearbyBatchWithOpenRouter, analyzeWithOpenRouter } from '../src/services/openrouter';
import { NearbyPlaceData, PlaceData } from '../src/types';
import { createMockEnv } from './helpers/mockEnv';

const OPENROUTER_MODEL_ID = 'google/gemini-3.1-flash-lite-preview';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenRouter service', () => {
  it('uses the configured OpenRouter model for single-place analysis', async () => {
    const { env } = createMockEnv();
    const requests: Record<string, unknown>[] = [];
    const requestHeaders: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
        requestHeaders.push(new Headers(init?.headers));
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  placeName: 'テスト店',
                  address: '東京都新宿区',
                  sakuraScore: 10,
                  estimatedRealRating: 4.1,
                  googleRating: 4.2,
                  tabelogRating: null,
                  verdict: '安全',
                  risks: [{ category: '総合', riskLevel: 'low', description: '目立ったリスクはありません。' }],
                  suspiciousKeywordsFound: [],
                  summary: '安定しています。',
                  reviewDistribution: [
                    { star: 1, percentage: 5 },
                    { star: 2, percentage: 10 },
                    { star: 3, percentage: 20 },
                    { star: 4, percentage: 35 },
                    { star: 5, percentage: 30 },
                  ],
                }),
              },
            },
          ],
        });
      }),
    );

    await analyzeWithOpenRouter('テスト店', buildPlace(), 'google/gemini-3.1-flash-lite-preview', env, 1);

    expect(requests[0]?.model).toBe(OPENROUTER_MODEL_ID);
    expect(requests[0]?.max_tokens).toBe(3200);
    expect(requests[0]?.reasoning).toEqual({ effort: 'none', exclude: true });
    expect(requests[0]?.plugins).toEqual([{ id: 'web', engine: 'exa', max_results: 3 }]);
    expect(requestHeaders[0]?.get('X-Title')).toBe('Bottakuri Checker');
  });

  it('caps OpenRouter web result count at the configured speed-focused maximum', async () => {
    const { env } = createMockEnv({ OPENROUTER_WEB_MAX_RESULTS: '7' });
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  placeName: 'テスト店',
                  address: '東京都新宿区',
                  sakuraScore: 10,
                  estimatedRealRating: 4.1,
                  googleRating: 4.2,
                  tabelogRating: null,
                  verdict: '安全',
                  componentSignals: {
                    reviewTextRisk: 0,
                    fakePraiseRisk: 0,
                    externalComplaintRisk: 0,
                    priceOpacityRisk: 0,
                    catchSalesRisk: 0,
                    billingTroubleRisk: 0,
                    starPatternRiskObservation: 0,
                    criticalComplaintCount: 0,
                    explicitBillingComplaintCount: 0,
                    recentLowStarBillingComplaintCount: 0,
                  },
                  evidence: [],
                  risks: [{ category: '総合', riskLevel: 'low', description: '目立ったリスクはありません。' }],
                  suspiciousKeywordsFound: [],
                  summary: '安定しています。',
                  reviewDistribution: [
                    { star: 1, percentage: 5 },
                    { star: 2, percentage: 10 },
                    { star: 3, percentage: 20 },
                    { star: 4, percentage: 35 },
                    { star: 5, percentage: 30 },
                  ],
                  reviewDistributionSource: 'model_estimated',
                }),
              },
            },
          ],
        });
      }),
    );

    await analyzeWithOpenRouter('テスト店', buildPlace(), 'google/gemini-3.1-flash-lite-preview', env, 1);

    expect(requests[0]?.plugins).toEqual([{ id: 'web', engine: 'exa', max_results: 3 }]);
  });

  it('sanitizes non-ASCII OpenRouter title headers for Workers', async () => {
    const { env } = createMockEnv({ OPENROUTER_APP_NAME: '飲食店サクラチェッカー' });
    const requestHeaders: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestHeaders.push(new Headers(init?.headers));
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  placeName: 'テスト店',
                  address: '東京都新宿区',
                  sakuraScore: 10,
                  estimatedRealRating: 4.1,
                  googleRating: 4.2,
                  tabelogRating: null,
                  verdict: '安全',
                  risks: [{ category: '総合', riskLevel: 'low', description: '目立ったリスクはありません。' }],
                  suspiciousKeywordsFound: [],
                  summary: '安定しています。',
                  reviewDistribution: [
                    { star: 1, percentage: 5 },
                    { star: 2, percentage: 10 },
                    { star: 3, percentage: 20 },
                    { star: 4, percentage: 35 },
                    { star: 5, percentage: 30 },
                  ],
                }),
              },
            },
          ],
        });
      }),
    );

    await analyzeWithOpenRouter('テスト店', buildPlace(), 'google/gemini-3.1-flash-lite-preview', env, 1);

    expect(requestHeaders[0]?.get('X-Title')).toBe('Bottakuri Checker');
  });

  it('uses the configured OpenRouter model for nearby batch analysis', async () => {
    const { env } = createMockEnv();
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rankings: [
                    {
                      placeId: 'nearby-place-id',
                      trustScore: 80,
                      sakuraScore: 20,
                      suspicionLevel: 'low',
                      summary: '安定',
                      reasons: ['レビュー数が十分'],
                    },
                  ],
                }),
              },
            },
          ],
        });
      }),
    );

    await analyzeNearbyBatchWithOpenRouter(
      { placeName: '起点', location: { lat: 35.6813, lng: 139.7672 }, radiusMeters: 800 },
      [buildNearbyPlace()],
      'google/gemini-3.1-flash-lite-preview',
      env,
    );

    expect(requests[0]?.model).toBe(OPENROUTER_MODEL_ID);
    expect(requests[0]?.reasoning).toEqual({ effort: 'none', exclude: true });
  });

  it('rejects malformed nearby batch analysis payloads', async () => {
    const { env } = createMockEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  rankings: [{ placeId: 'nearby-place-id', trustScore: 80 }],
                }),
              },
            },
          ],
        }),
      ),
    );

    await expect(
      analyzeNearbyBatchWithOpenRouter(
        { placeName: '起点', location: { lat: 35.6813, lng: 139.7672 }, radiusMeters: 800 },
        [buildNearbyPlace()],
        'google/gemini-3.1-flash-lite-preview',
        env,
      ),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', status: 503 });
  });
});

function buildPlace(): PlaceData {
  return {
    placeId: 'place-id',
    name: 'テスト店',
    address: '東京都新宿区',
    types: ['restaurant'],
    categories: ['restaurant'],
    googleRating: 4.2,
    userRatingCount: 120,
    reviews: [{ rating: 4, text: '落ち着いて使える店です。', publishTime: '2026-04-01T00:00:00Z' }],
  };
}

function buildNearbyPlace(): NearbyPlaceData {
  return {
    placeId: 'nearby-place-id',
    name: '近隣店',
    genre: 'レストラン',
    types: ['restaurant'],
    categories: ['restaurant'],
    address: '東京都千代田区',
    googleRating: 4,
    userRatingCount: 80,
    location: { lat: 35.6814, lng: 139.7673 },
    distanceMeters: 120,
  };
}
