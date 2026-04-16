import { describe, expect, it } from 'vitest';

import { normalizeAnalysis } from '../src/domain/normalization';
import { adjustRiskScoreByDiscrepancy, looksLikeChainStore, mapTabelogToGoogleEquivalent } from '../src/domain/scoring';
import { PlaceData } from '../src/types';
import { clampNumber, sanitizeQuery } from '../src/utils/validation';

describe('worker logic utilities', () => {
  it('sanitizeQuery removes control characters and normalizes whitespace', () => {
    expect(sanitizeQuery('  新宿\u0000  居酒屋\n\tA  ')).toBe('新宿 居酒屋 A');
  });

  it('clampNumber returns bounded values', () => {
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(7, 0, 10)).toBe(7);
    expect(clampNumber(11, 0, 10)).toBe(10);
  });

  it('mapTabelogToGoogleEquivalent maps known anchor points', () => {
    expect(mapTabelogToGoogleEquivalent(3.0)).toBeCloseTo(2.5, 5);
    expect(mapTabelogToGoogleEquivalent(3.6)).toBeCloseTo(4.3, 5);
    expect(mapTabelogToGoogleEquivalent(4.2)).toBeCloseTo(4.9, 5);
  });

  it('adjustRiskScoreByDiscrepancy applies penalty and chain-store reduction', () => {
    expect(adjustRiskScoreByDiscrepancy(30, 4.2, 3.0, '個人店')).toBe(64);
    expect(adjustRiskScoreByDiscrepancy(30, 4.2, 3.0, '松屋 新宿西口店')).toBe(50);
  });

  it('looksLikeChainStore uses defaults and supports environment overrides', () => {
    expect(looksLikeChainStore('サイゼリヤ 新宿西口店')).toBe(true);
    expect(looksLikeChainStore('個人店', '個人店,テストチェーン')).toBe(true);
    expect(looksLikeChainStore('サイゼリヤ 新宿西口店', '個人店,テストチェーン')).toBe(false);
  });

  it('normalizeAnalysis keeps tabelog rating only when tabelog citation exists', () => {
    const place: PlaceData = {
      placeId: 'place-id',
      name: '検証店舗',
      address: '東京都新宿区',
      googleRating: 3.5,
      userRatingCount: 120,
      reviews: [],
    };

    const report: Record<string, unknown> = {
      placeName: '検証店舗',
      address: '東京都新宿区',
      sakuraScore: 20,
      estimatedRealRating: 3.2,
      googleRating: 3.5,
      tabelogRating: 3.2,
      verdict: '安全',
      risks: [{ category: '乖離', riskLevel: 'low', description: '乖離は小さいです' }],
      suspiciousKeywordsFound: [],
      summary: '問題は見つかりませんでした。',
      reviewDistribution: [
        { star: 1, percentage: 10 },
        { star: 2, percentage: 10 },
        { star: 3, percentage: 20 },
        { star: 4, percentage: 30 },
        { star: 5, percentage: 30 },
      ],
    };

    const withTabelogCitation = normalizeAnalysis(report, place, 'google/gemini-3-flash-preview', 'ok', false, [
      { title: '食べログ', uri: 'https://tabelog.com/tokyo/A1304/A130401/12345678/' },
    ]);
    expect(withTabelogCitation.tabelogRating).toBeCloseTo(3.2, 2);

    const withoutTabelogCitation = normalizeAnalysis(report, place, 'google/gemini-3-flash-preview', 'ok', false, [
      { title: 'Google Maps', uri: 'https://www.google.com/maps/place/?q=place_id:place-id' },
    ]);
    expect(withoutTabelogCitation.tabelogRating).toBeUndefined();
  });

  it('normalizeAnalysis falls back for invalid model output', () => {
    const place: PlaceData = {
      placeId: 'place-id',
      name: '検証店舗',
      address: '東京都渋谷区',
      googleRating: 4.0,
      userRatingCount: 42,
      reviews: [],
    };

    const normalized = normalizeAnalysis(
      {
        sakuraScore: 'invalid',
        summary: '',
        risks: [{ category: '', riskLevel: 'unknown', description: '' }],
        suspiciousKeywordsFound: ['  怪しい  ', '怪しい', '', 123],
        reviewDistribution: [{ star: 5, percentage: 0 }],
      },
      place,
      'google/gemini-3-flash-preview',
      'ok',
      false,
      [],
    );

    expect(normalized.placeName).toBe(place.name);
    expect(normalized.address).toBe(place.address);
    expect(normalized.sakuraScore).toBeGreaterThanOrEqual(0);
    expect(normalized.risks).toHaveLength(1);
    expect(normalized.suspiciousKeywordsFound).toEqual(['怪しい']);
    expect(normalized.reviewDistribution.reduce((sum, item) => sum + item.percentage, 0)).toBe(100);
  });
});
