import {
  AnalysisEvidence,
  AnalysisReport,
  AnalysisRisk,
  BudgetState,
  ComponentScores,
  ComponentSignals,
  GroundingUrl,
  PlaceData,
  PlacePriceRange,
  PlaceReview,
  ReviewDistribution,
  ReviewDistributionSource,
} from '../types';
import { hasDomainCitation } from '../services/openrouter';
import {
  ScoringContext,
  computeDeterministicSakuraScore,
  deriveVerdict,
  inferScoreFromText,
  mapTabelogToGoogleEquivalent,
} from './scoring';
import { clampNumber, toFiniteNumber } from '../utils/validation';

const BILLING_TROUBLE_KEYWORDS = [
  'ぼったくり',
  'ボッタクリ',
  '詐欺',
  '高額請求',
  '不当請求',
  '会計がおかしい',
  '会計が違う',
  '請求額',
  '料金が違う',
  'メニューと違う',
  '勝手に請求',
  '説明なし',
  '説明がない',
  'チャージ料',
  'サービス料',
  'お通し',
  '席料',
];

const CATCH_SALES_KEYWORDS = ['客引き', 'キャッチ', '呼び込み', '連れて行かれた', '案内された', '勧誘'];

const PRICE_OPACITY_KEYWORDS = [
  '値段が書いてない',
  '価格が不明',
  '料金不明',
  'メニューにない',
  '金額が違う',
  '明細がない',
];

const TROUBLE_MODIFIERS = [
  '説明なし',
  '説明がない',
  '勝手に',
  '高額',
  '不当',
  '会計',
  '請求',
  'メニューと違う',
  '明細',
  '聞いてない',
  '知らない',
];

const EVIDENCE_CATEGORIES: AnalysisEvidence['category'][] = [
  'billing_trouble',
  'price_opacity',
  'catch_sales',
  'fake_praise',
  'review_distribution',
  'rating_gap',
  'external_reputation',
  'low_information',
  'place_exception',
  'other',
];

const EVIDENCE_SOURCES: AnalysisEvidence['source'][] = [
  'google_review_sample',
  'external_site',
  'model',
  'deterministic_rule',
  'place_metadata',
];

export function normalizeAnalysis(
  report: Record<string, unknown>,
  place: PlaceData,
  model: string,
  budgetState: BudgetState,
  cached: boolean,
  citations: GroundingUrl[],
  chainStoreKeywordsRaw?: string,
): AnalysisReport {
  const rawModelScore = clampScore(toFiniteNumber(report.sakuraScore) ?? inferScoreFromText(String(report.summary || '')));
  const hasTabelogCitation = hasDomainCitation(citations, 'tabelog.com');
  const tabelogRating = hasTabelogCitation ? normalizeTabelogRating(toFiniteNumber(report.tabelogRating)) : null;
  const modelEstimated = toFiniteNumber(report.estimatedRealRating);
  const tabelogComparable = tabelogRating === null ? null : mapTabelogToGoogleEquivalent(tabelogRating);
  const estimated = normalizeEstimatedRealRating({
    googleRating: place.googleRating,
    modelEstimated,
    rawModelScore,
    tabelogComparable,
    hasExternalCitation: citations.length > 0,
  });

  const modelSignals = normalizeComponentSignals(report.componentSignals);
  const modelEvidence = normalizeEvidence(report.evidence);
  const sampleDetection = detectEvidenceFromReviewSamples(place.reviews);
  const evidence = mergeEvidence([...modelEvidence, ...sampleDetection.evidence]);
  const componentSignals = reinforceSignalsWithDeterministicEvidence(modelSignals, sampleDetection);

  const distributionCandidate = resolveReviewDistribution(report, place);
  const categories = place.categories || [];
  const types = place.types || [];
  const scoringContext: ScoringContext = {
    placeName: place.name,
    googleRating: place.googleRating,
    estimatedRealRating: estimated.value,
    userRatingCount: place.userRatingCount,
    reviewSampleCount: distributionCandidate.reviewSampleCount,
    reviewDistributionSource: distributionCandidate.scoringSource,
    primaryType: place.primaryType,
    types,
    categories,
    genre: place.genre,
    priceLevel: place.priceLevel,
    priceRangeLabel: formatPriceRangeLabel(place.priceRange),
    chainStoreKeywordsRaw,
    hasTabelogCitation,
    estimatedRealRatingSource: estimated.source,
  };

  const scoring = computeDeterministicSakuraScore({
    signals: componentSignals,
    evidence,
    reviewDistribution: distributionCandidate.scoringDistribution,
    context: scoringContext,
  });
  const sakuraScore = scoring.finalScore;
  const verdict = deriveVerdict(sakuraScore);
  const exceptionEvidence: AnalysisEvidence[] =
    scoring.exceptionPolicy.kind !== 'none'
      ? [
          {
            category: 'place_exception',
            severity: 20,
            source: 'deterministic_rule',
            description: scoring.exceptionPolicy.reason,
          },
        ]
      : [];
  const finalEvidence = mergeEvidence([...evidence, ...exceptionEvidence]);
  const reviewDistribution =
    distributionCandidate.outputDistribution.length > 0
      ? distributionCandidate.outputDistribution
      : estimateDistribution(sakuraScore);
  const reviewDistributionSource: ReviewDistributionSource =
    distributionCandidate.outputDistribution.length > 0 ? distributionCandidate.outputSource : 'model_estimated';
  const risks = normalizeRisks(report.risks, scoring.componentScores, scoring.exceptionPolicy.reason, scoring.exceptionPolicy.kind);
  const suspiciousKeywordsFound = normalizeKeywords([
    ...(Array.isArray(report.suspiciousKeywordsFound) ? report.suspiciousKeywordsFound : []),
    ...sampleDetection.keywords,
  ]);
  const summary = normalizeSummary(report.summary, risks, verdict, scoring.componentScores);

  return {
    placeName: typeof report.placeName === 'string' && report.placeName.trim() ? report.placeName.trim() : place.name,
    address: typeof report.address === 'string' && report.address.trim() ? report.address.trim() : place.address,
    ...(place.location ? { location: place.location } : {}),
    ...(place.genre ? { genre: place.genre } : {}),
    ...(categories.length > 0 ? { category: categories[0], categories } : {}),
    metadata: {
      ...(place.genre ? { genre: place.genre } : {}),
      ...(categories.length > 0 ? { category: categories[0], categories } : {}),
      ...(place.primaryType ? { primaryType: place.primaryType } : {}),
      types,
      placeId: place.placeId,
    },
    sakuraScore,
    estimatedRealRating: roundTo(estimated.value, 2),
    estimatedRealRatingSource: estimated.source,
    googleRating: place.googleRating,
    tabelogRating: tabelogRating === null ? undefined : roundTo(tabelogRating, 2),
    verdict,
    confidence: scoring.confidence,
    confidenceReasons: scoring.confidenceReasons,
    componentScores: scoring.componentScores,
    scoringDebug: {
      rawModelScore,
      deterministicScore: scoring.deterministicScore,
      scoreBeforeException: scoring.scoreBeforeException,
      finalScore: scoring.finalScore,
      appliedFloors: scoring.appliedFloors,
      appliedCaps: scoring.appliedCaps,
      appliedMultipliers: scoring.appliedMultipliers,
    },
    exceptionPolicy: scoring.exceptionPolicy,
    risks,
    suspiciousKeywordsFound,
    summary,
    reviewDistribution,
    reviewDistributionSource,
    evidence: finalEvidence,
    groundingUrls: citations,
    meta: {
      cached,
      model,
      generatedAt: new Date().toISOString(),
      budgetState,
      scoringVersion: 2,
    },
  };
}

export function normalizeComponentSignals(raw: unknown): ComponentSignals {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyComponentSignals();
  }

  const record = raw as Record<string, unknown>;
  return {
    reviewTextRisk: clampScore(record.reviewTextRisk),
    fakePraiseRisk: clampScore(record.fakePraiseRisk),
    externalComplaintRisk: clampScore(record.externalComplaintRisk),
    priceOpacityRisk: clampScore(record.priceOpacityRisk),
    catchSalesRisk: clampScore(record.catchSalesRisk),
    billingTroubleRisk: clampScore(record.billingTroubleRisk),
    starPatternRiskObservation: clampScore(record.starPatternRiskObservation),
    criticalComplaintCount: clampCount(record.criticalComplaintCount),
    explicitBillingComplaintCount: clampCount(record.explicitBillingComplaintCount),
    recentLowStarBillingComplaintCount: clampCount(record.recentLowStarBillingComplaintCount),
  };
}

export function normalizeEvidence(raw: unknown): AnalysisEvidence[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): AnalysisEvidence | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const description = typeof record.description === 'string' ? record.description.trim().slice(0, 320) : '';
      if (!description) return null;
      const category = EVIDENCE_CATEGORIES.includes(record.category as AnalysisEvidence['category'])
        ? (record.category as AnalysisEvidence['category'])
        : 'other';
      const source = EVIDENCE_SOURCES.includes(record.source as AnalysisEvidence['source'])
        ? (record.source as AnalysisEvidence['source'])
        : 'model';
      const snippet = typeof record.snippet === 'string' && record.snippet.trim() ? record.snippet.trim().slice(0, 240) : undefined;
      return {
        category,
        severity: clampScore(record.severity),
        source,
        ...(snippet ? { snippet } : {}),
        description,
      };
    })
    .filter((item): item is AnalysisEvidence => item !== null)
    .slice(0, 12);
}

export function normalizeReviewDistributionSource(raw: unknown): ReviewDistributionSource {
  if (
    raw === 'google_aggregate' ||
    raw === 'google_review_sample' ||
    raw === 'external_site' ||
    raw === 'model_estimated' ||
    raw === 'unavailable'
  ) {
    return raw;
  }
  return 'model_estimated';
}

export function buildDistributionFromReviewSample(reviews: PlaceReview[]): ReviewDistribution[] {
  const counts = new Map<number, number>();
  for (const review of reviews) {
    const star = Math.round(review.rating);
    if (star < 1 || star > 5) continue;
    counts.set(star, (counts.get(star) || 0) + 1);
  }

  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];

  return normalizeDistribution(
    [1, 2, 3, 4, 5].map((star) => ({
      star,
      percentage: Math.round(((counts.get(star) || 0) / total) * 100),
    })),
  );
}

function normalizeEstimatedRealRating(params: {
  googleRating: number;
  modelEstimated: number | null;
  rawModelScore: number;
  tabelogComparable: number | null;
  hasExternalCitation: boolean;
}): { value: number; source: 'tabelog' | 'model_external' | 'model_only' | 'fallback' } {
  if (params.tabelogComparable !== null) {
    const value =
      params.modelEstimated !== null
        ? params.modelEstimated * 0.3 + params.tabelogComparable * 0.7
        : params.tabelogComparable;
    return { value: clampNumber(value, 1, 5), source: 'tabelog' };
  }

  if (params.modelEstimated !== null) {
    return {
      value: clampNumber(params.modelEstimated, 1, 5),
      source: params.hasExternalCitation ? 'model_external' : 'model_only',
    };
  }

  return {
    value: clampNumber(params.googleRating - params.rawModelScore / 100, 1, 5),
    source: 'fallback',
  };
}

function resolveReviewDistribution(
  report: Record<string, unknown>,
  place: PlaceData,
): {
  scoringDistribution: ReviewDistribution[];
  scoringSource: ReviewDistributionSource;
  outputDistribution: ReviewDistribution[];
  outputSource: ReviewDistributionSource;
  reviewSampleCount: number;
} {
  const sampleDistribution = place.reviewDistributionSample || buildDistributionFromReviewSample(place.reviews);
  const reviewSampleCount =
    typeof place.reviewSampleCount === 'number' ? place.reviewSampleCount : place.reviews.filter((review) => review.rating > 0).length;
  if (sampleDistribution.length > 0) {
    return {
      scoringDistribution: sampleDistribution,
      scoringSource: 'google_review_sample',
      outputDistribution: sampleDistribution,
      outputSource: 'google_review_sample',
      reviewSampleCount,
    };
  }

  const modelDistribution = normalizeDistribution(report.reviewDistribution);
  if (modelDistribution.length > 0) {
    const source = normalizeReviewDistributionSource(report.reviewDistributionSource);
    const safeSource = source === 'unavailable' || source === 'google_review_sample' ? 'model_estimated' : source;
    return {
      scoringDistribution: modelDistribution,
      scoringSource: safeSource,
      outputDistribution: modelDistribution,
      outputSource: safeSource,
      reviewSampleCount,
    };
  }

  return {
    scoringDistribution: [],
    scoringSource: 'unavailable',
    outputDistribution: [],
    outputSource: 'unavailable',
    reviewSampleCount,
  };
}

function normalizeRisks(
  raw: unknown,
  componentScores: ComponentScores,
  exceptionReason: string,
  exceptionKind: string,
): AnalysisRisk[] {
  const normalized: AnalysisRisk[] = Array.isArray(raw)
    ? raw
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
    : [];

  const supplemental = buildRisksFromComponentScores(componentScores);
  if (exceptionKind !== 'none') {
    supplemental.push({
      category: '例外補正',
      riskLevel: 'low',
      description: exceptionReason,
    });
  }

  const combined = dedupeRisks([...normalized, ...supplemental]).slice(0, 8);
  return combined.length > 0
    ? combined
    : [
        {
          category: '総合評価',
          riskLevel: 'low',
          description: '取得できた情報の範囲では、強いリスク根拠は確認されていません。',
        },
      ];
}

function buildRisksFromComponentScores(componentScores: ComponentScores): AnalysisRisk[] {
  const risks: AnalysisRisk[] = [];
  if (componentScores.reviewTextRisk >= 70) {
    risks.push({
      category: 'レビュー本文',
      riskLevel: 'high',
      description: '会計・料金・誘導に関する具体的な懸念がレビュー本文から確認されています。',
    });
  } else if (componentScores.reviewTextRisk >= 40) {
    risks.push({
      category: 'レビュー本文',
      riskLevel: 'medium',
      description: 'レビュー本文に注意すべき表現が一部あります。',
    });
  }
  if (componentScores.ratingGapRisk >= 70) {
    risks.push({
      category: '評価乖離',
      riskLevel: 'high',
      description: 'Google評価と外部評価換算値の乖離が大きく、追加確認を推奨します。',
    });
  } else if (componentScores.ratingGapRisk >= 40) {
    risks.push({
      category: '評価乖離',
      riskLevel: 'medium',
      description: 'Google評価と外部評価換算値に一定の差があります。',
    });
  }
  if (componentScores.starPatternRisk >= 70) {
    risks.push({
      category: '評価分布',
      riskLevel: 'high',
      description: '星分布に偏りが見られますが、本文や外部評判と合わせて判断しています。',
    });
  } else if (componentScores.starPatternRisk >= 40) {
    risks.push({
      category: '評価分布',
      riskLevel: 'medium',
      description: '星分布にやや不自然な偏りがあります。',
    });
  }
  if (componentScores.externalComplaintRisk >= 70) {
    risks.push({
      category: '外部評判',
      riskLevel: 'high',
      description: '外部サイト上の苦情シグナルが強めです。',
    });
  }
  return risks;
}

function normalizeKeywords(rawItems: unknown[]): string[] {
  const unique = new Set<string>();
  for (const item of rawItems) {
    if (typeof item !== 'string') continue;
    const keyword = item.trim();
    if (!keyword) continue;
    unique.add(keyword);
    if (unique.size >= 15) break;
  }
  return Array.from(unique);
}

function normalizeSummary(
  raw: unknown,
  risks: AnalysisRisk[],
  verdict: '安全' | '注意' | '危険',
  componentScores: ComponentScores,
): string {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (verdict === '危険' && componentScores.reviewTextRisk >= 70) {
    return '会計・料金面の具体的な苦情が複数あり、利用前の追加確認を推奨します。';
  }
  if (verdict === '注意') {
    return '一部に注意すべきシグナルがあるため、利用前に料金説明や外部評判の追加確認を推奨します。';
  }
  const highestRisk = risks.find((risk) => risk.riskLevel === 'high') || risks[0];
  return `判定: ${verdict}。主な判断理由: ${highestRisk?.description || '強いリスク根拠は確認されていません。'}`;
}

function normalizeDistribution(raw: unknown): ReviewDistribution[] {
  if (!Array.isArray(raw)) return [];

  const byStar = new Map<number, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const star = Math.round(toFiniteNumber(entry.star) ?? 0);
    const percentage = Math.round(toFiniteNumber(entry.percentage) ?? 0);
    if (star < 1 || star > 5 || percentage < 0) continue;
    byStar.set(star, percentage);
  }

  if (byStar.size === 0) return [];

  const rawItems: ReviewDistribution[] = [1, 2, 3, 4, 5].map((star) => ({
    star,
    percentage: Math.max(0, byStar.get(star) || 0),
  }));

  const total = rawItems.reduce((sum, item) => sum + item.percentage, 0);
  if (total <= 0) return [];

  const normalized = rawItems.map((item) => ({
    star: item.star,
    percentage: Math.round((item.percentage / total) * 100),
  }));

  rebalanceDistribution(normalized);
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

function detectEvidenceFromReviewSamples(reviews: PlaceReview[]): {
  evidence: AnalysisEvidence[];
  keywords: string[];
  explicitBillingComplaintCount: number;
  recentLowStarBillingComplaintCount: number;
  billingTroubleRisk: number;
  priceOpacityRisk: number;
  catchSalesRisk: number;
} {
  const evidence: AnalysisEvidence[] = [];
  const keywords = new Set<string>();
  let explicitBillingComplaintCount = 0;
  let recentLowStarBillingComplaintCount = 0;
  let billingTroubleRisk = 0;
  let priceOpacityRisk = 0;
  let catchSalesRisk = 0;

  for (const review of reviews) {
    const text = review.text.normalize('NFKC');
    if (!text) continue;
    const billingMatches = BILLING_TROUBLE_KEYWORDS.filter((keyword) => text.includes(keyword.normalize('NFKC')));
    const catchMatches = CATCH_SALES_KEYWORDS.filter((keyword) => text.includes(keyword.normalize('NFKC')));
    const priceMatches = PRICE_OPACITY_KEYWORDS.filter((keyword) => text.includes(keyword.normalize('NFKC')));
    for (const keyword of [...billingMatches, ...catchMatches, ...priceMatches]) keywords.add(keyword);

    const hasTroubleModifier = TROUBLE_MODIFIERS.some((keyword) => text.includes(keyword.normalize('NFKC')));
    const hasChargeOnlyTerm = billingMatches.some((keyword) => ['チャージ料', 'サービス料', 'お通し', '席料'].includes(keyword));
    const hasStrongBillingTerm = billingMatches.some((keyword) => !['説明なし', '説明がない', 'チャージ料', 'サービス料', 'お通し', '席料'].includes(keyword));

    if (hasStrongBillingTerm || (hasChargeOnlyTerm && hasTroubleModifier)) {
      const severity = hasStrongBillingTerm ? 85 : 75;
      explicitBillingComplaintCount += 1;
      billingTroubleRisk = Math.max(billingTroubleRisk, severity);
      if (review.rating > 0 && review.rating <= 2) recentLowStarBillingComplaintCount += 1;
      evidence.push({
        category: 'billing_trouble',
        severity,
        source: 'google_review_sample',
        snippet: text.slice(0, 240),
        description: hasStrongBillingTerm
          ? 'Googleレビューサンプル内に会計・請求トラブルを示す表現があります。'
          : 'Googleレビューサンプル内でチャージ等が説明不足や高額請求の文脈で言及されています。',
      });
    }

    if (priceMatches.length > 0 || (hasChargeOnlyTerm && hasTroubleModifier)) {
      priceOpacityRisk = Math.max(priceOpacityRisk, 70);
      evidence.push({
        category: 'price_opacity',
        severity: 70,
        source: 'google_review_sample',
        snippet: text.slice(0, 240),
        description: 'Googleレビューサンプル内に価格表示や明細の不透明さを示す表現があります。',
      });
    }

    if (catchMatches.length > 0) {
      catchSalesRisk = Math.max(catchSalesRisk, 75);
      evidence.push({
        category: 'catch_sales',
        severity: 75,
        source: 'google_review_sample',
        snippet: text.slice(0, 240),
        description: 'Googleレビューサンプル内に客引き・誘導に関する表現があります。',
      });
    }
  }

  return {
    evidence: mergeEvidence(evidence),
    keywords: Array.from(keywords),
    explicitBillingComplaintCount,
    recentLowStarBillingComplaintCount,
    billingTroubleRisk,
    priceOpacityRisk,
    catchSalesRisk,
  };
}

function reinforceSignalsWithDeterministicEvidence(
  signals: ComponentSignals,
  detection: ReturnType<typeof detectEvidenceFromReviewSamples>,
): ComponentSignals {
  const explicitBillingComplaintCount = Math.max(
    signals.explicitBillingComplaintCount,
    detection.explicitBillingComplaintCount,
  );
  const recentLowStarBillingComplaintCount = Math.max(
    signals.recentLowStarBillingComplaintCount,
    detection.recentLowStarBillingComplaintCount,
  );
  return {
    ...signals,
    billingTroubleRisk: Math.max(signals.billingTroubleRisk, detection.billingTroubleRisk),
    priceOpacityRisk: Math.max(signals.priceOpacityRisk, detection.priceOpacityRisk),
    catchSalesRisk: Math.max(signals.catchSalesRisk, detection.catchSalesRisk),
    criticalComplaintCount: Math.max(signals.criticalComplaintCount, explicitBillingComplaintCount),
    explicitBillingComplaintCount,
    recentLowStarBillingComplaintCount,
  };
}

function mergeEvidence(items: AnalysisEvidence[]): AnalysisEvidence[] {
  const byKey = new Map<string, AnalysisEvidence>();
  for (const item of items) {
    const key = `${item.category}:${item.source}:${item.description}:${item.snippet || ''}`;
    const existing = byKey.get(key);
    if (!existing || existing.severity < item.severity) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 12);
}

function dedupeRisks(items: AnalysisRisk[]): AnalysisRisk[] {
  const seen = new Set<string>();
  const result: AnalysisRisk[] = [];
  for (const item of items) {
    const key = `${item.category}:${item.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function emptyComponentSignals(): ComponentSignals {
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
  };
}

function normalizeTabelogRating(value: number | null): number | null {
  if (value === null) return null;
  if (value < 2.0 || value > 4.5) return null;
  return clampNumber(value, 2.0, 4.2);
}

function clampScore(value: unknown): number {
  const parsed = toFiniteNumber(value);
  return Math.round(clampNumber(parsed ?? 0, 0, 100));
}

function clampCount(value: unknown): number {
  const parsed = toFiniteNumber(value);
  return Math.round(clampNumber(parsed ?? 0, 0, 50));
}

function rebalanceDistribution(distribution: ReviewDistribution[]): void {
  const adjustedTotal = distribution.reduce((sum, item) => sum + item.percentage, 0);
  const diff = 100 - adjustedTotal;
  if (diff > 0) {
    const target = distribution.find((item) => item.star === 5) || distribution[distribution.length - 1];
    target.percentage += diff;
  } else if (diff < 0) {
    let remaining = -diff;
    const target = distribution.find((item) => item.star === 5) || distribution[distribution.length - 1];
    const reduction = Math.min(target.percentage, remaining);
    target.percentage -= reduction;
    remaining -= reduction;

    if (remaining > 0) {
      for (const item of distribution) {
        if (item === target || remaining <= 0) continue;
        const step = Math.min(item.percentage, remaining);
        item.percentage -= step;
        remaining -= step;
      }
    }
  }
}

function formatPriceRangeLabel(priceRange: PlacePriceRange | undefined): string | undefined {
  if (!priceRange) return undefined;
  const start = priceRange.startPrice?.units;
  const end = priceRange.endPrice?.units;
  if (start && end) return `${start}-${end}`;
  return start || end;
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
