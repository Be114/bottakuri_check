import { describe, expect, it } from 'vitest';

import { ComponentSignals, ReviewDistribution } from '../types';
import {
  ScoringContext,
  computeDeterministicSakuraScore,
  computeStarPatternRisk,
  deriveVerdict,
} from './scoring';

describe('deterministic sakura scoring', () => {
  it('floors the score for two explicit billing complaints', () => {
    const result = computeDeterministicSakuraScore({
      signals: makeSignals({
        billingTroubleRisk: 85,
        priceOpacityRisk: 55,
        explicitBillingComplaintCount: 2,
      }),
      evidence: [
        { category: 'billing_trouble', severity: 85, source: 'google_review_sample', description: '高額請求の苦情' },
        { category: 'billing_trouble', severity: 80, source: 'google_review_sample', description: '会計が違う苦情' },
      ],
      reviewDistribution: normalDistribution(),
      context: makeContext(),
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(75);
    expect(deriveVerdict(result.finalScore)).toBe('危険');
    expect(result.appliedFloors).toContain('explicit_billing_complaints_2_or_more');
  });

  it('caps the score when only the star pattern is suspicious', () => {
    const result = computeDeterministicSakuraScore({
      signals: makeSignals(),
      evidence: [],
      reviewDistribution: spikyDistribution(),
      context: makeContext({
        reviewDistributionSource: 'google_aggregate',
        reviewSampleCount: 120,
      }),
    });

    expect(result.finalScore).toBeLessThanOrEqual(55);
    expect(result.appliedCaps).toContain('only_star_pattern_evidence');
  });

  it('suppresses rating-gap-only risk for national chains', () => {
    const result = computeDeterministicSakuraScore({
      signals: makeSignals(),
      evidence: [],
      reviewDistribution: normalDistribution(),
      context: makeContext({
        placeName: 'サイゼリヤ 新宿西口店',
        googleRating: 4.2,
        estimatedRealRating: 3.2,
        estimatedRealRatingSource: 'tabelog',
      }),
    });

    expect(result.exceptionPolicy.kind).toBe('national_chain');
    expect(result.finalScore).toBeLessThanOrEqual(35);
    expect(result.componentScores.ratingGapRisk).toBeLessThanOrEqual(21);
  });

  it('allows national chains to become high risk when repeated billing trouble exists', () => {
    const result = computeDeterministicSakuraScore({
      signals: makeSignals({
        billingTroubleRisk: 90,
        priceOpacityRisk: 70,
        explicitBillingComplaintCount: 2,
      }),
      evidence: [
        { category: 'billing_trouble', severity: 90, source: 'google_review_sample', description: '会計がおかしい' },
        { category: 'billing_trouble', severity: 85, source: 'external_site', description: '高額請求の苦情' },
      ],
      reviewDistribution: normalDistribution(),
      context: makeContext({ placeName: '鳥貴族 テスト店' }),
    });

    expect(result.exceptionPolicy.kind).toBe('national_chain');
    expect(result.finalScore).toBeGreaterThanOrEqual(75);
  });

  it('keeps low-review new stores low-confidence and capped without critical evidence', () => {
    const result = computeDeterministicSakuraScore({
      signals: makeSignals(),
      evidence: [],
      reviewDistribution: spikyDistribution(),
      context: makeContext({
        userRatingCount: 8,
        googleRating: 4.8,
        estimatedRealRating: 4.6,
        reviewSampleCount: 2,
        reviewDistributionSource: 'google_review_sample',
      }),
    });

    expect(result.confidence).toBe('low');
    expect(result.finalScore).toBeLessThanOrEqual(45);
    expect(result.exceptionPolicy.kind).toBe('low_review_new_store');
  });

  it('does not make bar cover-charge mentions dangerous by themselves', () => {
    const result = computeDeterministicSakuraScore({
      signals: makeSignals(),
      evidence: [],
      reviewDistribution: normalDistribution(),
      context: makeContext({
        placeName: 'テストバー',
        primaryType: 'bar',
        types: ['bar'],
        genre: 'バー',
      }),
    });

    expect(result.componentScores.reviewTextRisk).toBe(0);
    expect(result.finalScore).toBeLessThan(40);
    expect(result.exceptionPolicy.kind).toBe('bar_or_izakaya_standard_charge');
  });

  it('raises bar risk when unexplained high charges are present', () => {
    const result = computeDeterministicSakuraScore({
      signals: makeSignals({
        billingTroubleRisk: 85,
        priceOpacityRisk: 80,
        explicitBillingComplaintCount: 1,
      }),
      evidence: [
        {
          category: 'billing_trouble',
          severity: 85,
          source: 'google_review_sample',
          description: '説明なしの高額チャージ請求',
        },
      ],
      reviewDistribution: normalDistribution(),
      context: makeContext({
        placeName: 'テストバー',
        primaryType: 'bar',
        types: ['bar'],
        genre: 'バー',
      }),
    });

    expect(result.appliedFloors).toContain('billing_complaint_with_price_opacity');
    expect(result.finalScore).toBeGreaterThanOrEqual(40);
  });

  it('caps model-estimated distribution risk', () => {
    expect(computeStarPatternRisk(spikyDistribution(), 'model_estimated', 120)).toBeLessThanOrEqual(20);
  });

  it('caps very small google review sample distribution risk', () => {
    expect(computeStarPatternRisk(spikyDistribution(), 'google_review_sample', 2)).toBeLessThanOrEqual(10);
  });

  it('keeps verdict thresholds consistent', () => {
    expect(deriveVerdict(39)).toBe('安全');
    expect(deriveVerdict(40)).toBe('注意');
    expect(deriveVerdict(70)).toBe('危険');
  });
});

function makeSignals(overrides: Partial<ComponentSignals> = {}): ComponentSignals {
  return {
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
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    placeName: '通常店舗',
    googleRating: 4,
    estimatedRealRating: 3.9,
    estimatedRealRatingSource: 'tabelog',
    userRatingCount: 100,
    reviewSampleCount: 8,
    reviewDistributionSource: 'google_review_sample',
    types: ['restaurant'],
    categories: ['restaurant'],
    ...overrides,
  };
}

function normalDistribution(): ReviewDistribution[] {
  return [
    { star: 1, percentage: 5 },
    { star: 2, percentage: 8 },
    { star: 3, percentage: 22 },
    { star: 4, percentage: 35 },
    { star: 5, percentage: 30 },
  ];
}

function spikyDistribution(): ReviewDistribution[] {
  return [
    { star: 1, percentage: 10 },
    { star: 2, percentage: 0 },
    { star: 3, percentage: 0 },
    { star: 4, percentage: 0 },
    { star: 5, percentage: 90 },
  ];
}
