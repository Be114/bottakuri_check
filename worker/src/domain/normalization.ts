import { AnalysisReport, AnalysisRisk, BudgetState, GroundingUrl, PlaceData, ReviewDistribution } from '../types';
import { hasDomainCitation } from '../services/openrouter';
import {
  adjustRiskScoreByDiscrepancy,
  deriveVerdict,
  inferScoreFromText,
  mapTabelogToGoogleEquivalent,
  verdictToMinScore,
} from './scoring';
import { clampNumber, toFiniteNumber } from '../utils/validation';

export function normalizeAnalysis(
  report: Record<string, unknown>,
  place: PlaceData,
  model: string,
  budgetState: BudgetState,
  cached: boolean,
  citations: GroundingUrl[],
  chainStoreKeywordsRaw?: string,
): AnalysisReport {
  const rawSakuraScore = clampNumber(
    Math.round(toFiniteNumber(report.sakuraScore) ?? inferScoreFromText(String(report.summary || ''))),
    0,
    100,
  );

  const rawVerdict = typeof report.verdict === 'string' ? report.verdict : '';
  const hasTabelogCitation = hasDomainCitation(citations, 'tabelog.com');
  const tabelogRating = hasTabelogCitation ? normalizeTabelogRating(toFiniteNumber(report.tabelogRating)) : null;
  const modelEstimated = toFiniteNumber(report.estimatedRealRating);
  const tabelogComparable = tabelogRating === null ? null : mapTabelogToGoogleEquivalent(tabelogRating);

  const estimatedRealRating = clampNumber(
    tabelogComparable !== null
      ? modelEstimated !== null
        ? modelEstimated * 0.3 + tabelogComparable * 0.7
        : tabelogComparable
      : modelEstimated !== null
        ? modelEstimated
        : clampNumber(place.googleRating - rawSakuraScore / 100, 1, 5),
    1,
    5,
  );

  const sakuraScore = adjustRiskScoreByDiscrepancy(
    rawSakuraScore,
    place.googleRating,
    estimatedRealRating,
    place.name,
    chainStoreKeywordsRaw,
  );
  const verdict: '安全' | '注意' | '危険' =
    rawVerdict === '安全' || rawVerdict === '注意' || rawVerdict === '危険'
      ? deriveVerdict(Math.max(sakuraScore, verdictToMinScore(rawVerdict)))
      : deriveVerdict(sakuraScore);

  const risks = normalizeRisks(report.risks);
  const suspiciousKeywordsFound = normalizeKeywords(report.suspiciousKeywordsFound);
  const summary = normalizeSummary(report.summary, risks, verdict);
  const reviewDistribution = normalizeDistribution(report.reviewDistribution, sakuraScore);

  return {
    placeName: typeof report.placeName === 'string' && report.placeName.trim() ? report.placeName.trim() : place.name,
    address: typeof report.address === 'string' && report.address.trim() ? report.address.trim() : place.address,
    sakuraScore,
    estimatedRealRating: roundTo(estimatedRealRating, 2),
    googleRating: place.googleRating,
    tabelogRating: tabelogRating === null ? undefined : roundTo(tabelogRating, 2),
    verdict,
    risks,
    suspiciousKeywordsFound,
    summary,
    reviewDistribution,
    groundingUrls: citations,
    meta: {
      cached,
      model,
      generatedAt: new Date().toISOString(),
      budgetState,
    },
  };
}

function normalizeRisks(raw: unknown): AnalysisRisk[] {
  if (!Array.isArray(raw)) {
    return [
      {
        category: '総合評価',
        riskLevel: 'medium',
        description: '十分なリスク情報を取得できなかったため、追加確認を推奨します。',
      },
    ];
  }

  const risks: AnalysisRisk[] = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const category = typeof record.category === 'string' && record.category.trim() ? record.category.trim() : null;
      const riskLevel =
        record.riskLevel === 'low' || record.riskLevel === 'medium' || record.riskLevel === 'high'
          ? record.riskLevel
          : 'medium';
      const description =
        typeof record.description === 'string' && record.description.trim()
          ? record.description.trim()
          : '詳細情報が不足しています。';
      if (!category) return null;
      return { category, riskLevel, description };
    })
    .filter((risk): risk is AnalysisRisk => risk !== null)
    .slice(0, 8);

  return risks.length > 0
    ? risks
    : [
        {
          category: '総合評価',
          riskLevel: 'medium',
          description: '十分なリスク情報を取得できなかったため、追加確認を推奨します。',
        },
      ];
}

function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const keyword = item.trim();
    if (!keyword) continue;
    unique.add(keyword);
    if (unique.size >= 15) break;
  }
  return Array.from(unique);
}

function normalizeSummary(raw: unknown, risks: AnalysisRisk[], verdict: '安全' | '注意' | '危険'): string {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  const highestRisk = risks.find((risk) => risk.riskLevel === 'high') || risks[0];
  return `判定: ${verdict}。主な判断理由: ${highestRisk?.description || '情報不足のため追加確認が必要です。'}`;
}

function normalizeDistribution(raw: unknown, score: number): ReviewDistribution[] {
  if (!Array.isArray(raw)) {
    return estimateDistribution(score);
  }

  const byStar = new Map<number, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const star = Math.round(toFiniteNumber(entry.star) ?? 0);
    const percentage = Math.round(toFiniteNumber(entry.percentage) ?? 0);
    if (star < 1 || star > 5 || percentage < 0) continue;
    byStar.set(star, percentage);
  }

  if (byStar.size === 0) {
    return estimateDistribution(score);
  }

  const rawItems: ReviewDistribution[] = [1, 2, 3, 4, 5].map((star) => ({
    star,
    percentage: Math.max(0, byStar.get(star) || 0),
  }));

  const total = rawItems.reduce((sum, item) => sum + item.percentage, 0);
  if (total <= 0) {
    return estimateDistribution(score);
  }

  const normalized = rawItems.map((item) => ({
    star: item.star,
    percentage: Math.round((item.percentage / total) * 100),
  }));

  const adjustedTotal = normalized.reduce((sum, item) => sum + item.percentage, 0);
  const diff = 100 - adjustedTotal;
  if (diff > 0) {
    const target = normalized.find((item) => item.star === 5) || normalized[normalized.length - 1];
    target.percentage += diff;
  } else if (diff < 0) {
    let remaining = -diff;
    const target = normalized.find((item) => item.star === 5) || normalized[normalized.length - 1];
    const reduction = Math.min(target.percentage, remaining);
    target.percentage -= reduction;
    remaining -= reduction;

    if (remaining > 0) {
      for (const item of normalized) {
        if (item === target || remaining <= 0) continue;
        const step = Math.min(item.percentage, remaining);
        item.percentage -= step;
        remaining -= step;
      }
    }
  }

  return normalized;
}

function estimateDistribution(score: number): ReviewDistribution[] {
  if (score >= 70) {
    return [
      { star: 1, percentage: 24 },
      { star: 2, percentage: 12 },
      { star: 3, percentage: 12 },
      { star: 4, percentage: 18 },
      { star: 5, percentage: 34 },
    ];
  }
  if (score >= 40) {
    return [
      { star: 1, percentage: 12 },
      { star: 2, percentage: 14 },
      { star: 3, percentage: 24 },
      { star: 4, percentage: 28 },
      { star: 5, percentage: 22 },
    ];
  }
  return [
    { star: 1, percentage: 5 },
    { star: 2, percentage: 8 },
    { star: 3, percentage: 22 },
    { star: 4, percentage: 35 },
    { star: 5, percentage: 30 },
  ];
}

function normalizeTabelogRating(value: number | null): number | null {
  if (value === null) return null;
  if (value < 2.0 || value > 4.5) return null;
  return clampNumber(value, 2.0, 4.2);
}

function roundTo(value: number, digits: number): number {
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

export function isAnalysisReport(value: unknown): value is AnalysisReport {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.placeName === 'string' &&
    typeof record.address === 'string' &&
    typeof record.sakuraScore === 'number' &&
    typeof record.verdict === 'string' &&
    typeof record.summary === 'string' &&
    Array.isArray(record.risks) &&
    Array.isArray(record.reviewDistribution) &&
    Array.isArray(record.groundingUrls) &&
    typeof record.meta === 'object' &&
    record.meta !== null
  );
}
