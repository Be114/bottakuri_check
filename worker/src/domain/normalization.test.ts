import { describe, expect, it } from 'vitest';

import { PlaceData } from '../types';
import { normalizeAnalysis } from './normalization';

describe('analysis normalization for deterministic scoring', () => {
  it('zero-fills missing componentSignals and does not trust raw LLM score alone', () => {
    const normalized = normalizeAnalysis(
      {
        placeName: '検証店舗',
        address: '東京都新宿区',
        sakuraScore: 95,
        estimatedRealRating: 4.1,
        verdict: '危険',
        risks: [],
        summary: '強い根拠は確認できません。',
        reviewDistribution: normalDistribution(),
      },
      buildPlace(),
      'model',
      'ok',
      false,
      [],
    );

    expect(normalized.componentScores?.reviewTextRisk).toBe(0);
    expect(normalized.sakuraScore).toBeLessThan(70);
    expect(normalized.verdict).toBe(normalized.sakuraScore >= 40 ? '注意' : '安全');
  });

  it('drops malformed evidence without throwing', () => {
    const normalized = normalizeAnalysis(
      {
        componentSignals: {},
        evidence: [null, { category: 'unknown', source: 'bad', severity: Number.NaN, description: '' }],
        risks: [],
        summary: '',
        reviewDistribution: normalDistribution(),
      },
      buildPlace(),
      'model',
      'ok',
      false,
      [],
    );

    expect(normalized.evidence).toEqual([]);
    expect(normalized.sakuraScore).toBeGreaterThanOrEqual(0);
  });

  it('falls back reviewDistributionSource when the model omits it', () => {
    const normalized = normalizeAnalysis(
      {
        componentSignals: {},
        risks: [],
        summary: '',
        reviewDistribution: normalDistribution(),
      },
      buildPlace({ reviews: [] }),
      'model',
      'ok',
      false,
      [],
    );

    expect(normalized.reviewDistributionSource).toBe('model_estimated');
    expect(normalized.reviewDistribution.reduce((sum, item) => sum + item.percentage, 0)).toBe(100);
  });

  it('does not accept tabelogRating without a tabelog citation', () => {
    const normalized = normalizeAnalysis(
      {
        componentSignals: {},
        tabelogRating: 3.2,
        estimatedRealRating: 3.2,
        risks: [],
        summary: '',
        reviewDistribution: normalDistribution(),
      },
      buildPlace(),
      'model',
      'ok',
      false,
      [{ title: 'Google Maps', uri: 'https://www.google.com/maps/place/?q=place_id:place-id' }],
    );

    expect(normalized.tabelogRating).toBeUndefined();
    expect(normalized.estimatedRealRatingSource).toBe('model_external');
  });

  it('keeps score and verdict consistent and adds optional scoring fields', () => {
    const normalized = normalizeAnalysis(
      {
        componentSignals: {
          reviewTextRisk: 0,
          fakePraiseRisk: 0,
          externalComplaintRisk: 0,
          priceOpacityRisk: 80,
          catchSalesRisk: 0,
          billingTroubleRisk: 85,
          starPatternRiskObservation: 0,
          criticalComplaintCount: 1,
          explicitBillingComplaintCount: 1,
          recentLowStarBillingComplaintCount: 0,
        },
        evidence: [
          {
            category: 'billing_trouble',
            severity: 85,
            source: 'google_review_sample',
            description: '説明なしの高額チャージ請求',
          },
        ],
        risks: [],
        summary: '',
        reviewDistribution: normalDistribution(),
      },
      buildPlace({ primaryType: 'bar', types: ['bar'], categories: ['バー'], genre: 'バー' }),
      'model',
      'ok',
      false,
      [],
    );

    expect(normalized.verdict).toBe(normalized.sakuraScore >= 70 ? '危険' : normalized.sakuraScore >= 40 ? '注意' : '安全');
    expect(normalized.confidence).toBeDefined();
    expect(normalized.componentScores).toBeDefined();
    expect(normalized.exceptionPolicy?.kind).toBe('bar_or_izakaya_standard_charge');
    expect(normalized.reviewDistributionSource).toBeDefined();
    expect(normalized.evidence?.length).toBeGreaterThan(0);
  });
});

function buildPlace(overrides: Partial<PlaceData> = {}): PlaceData {
  return {
    placeId: 'place-id',
    name: '検証店舗',
    address: '東京都新宿区',
    primaryType: 'restaurant',
    types: ['restaurant'],
    categories: ['restaurant'],
    googleRating: 4,
    userRatingCount: 120,
    reviews: [{ rating: 4, text: '落ち着いて使える店です。', publishTime: '2026-04-01T00:00:00Z' }],
    ...overrides,
  };
}

function normalDistribution() {
  return [
    { star: 1, percentage: 5 },
    { star: 2, percentage: 8 },
    { star: 3, percentage: 22 },
    { star: 4, percentage: 35 },
    { star: 5, percentage: 30 },
  ];
}
