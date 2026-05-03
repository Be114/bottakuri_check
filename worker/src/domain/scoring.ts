import {
  AnalysisEvidence,
  ComponentScores,
  ComponentSignals,
  ExceptionPolicyKind,
  ExceptionPolicyResult,
  ReviewDistribution,
  ReviewDistributionSource,
} from '../types';
import { clampNumber } from '../utils/validation';

interface ChainBrandDefinition {
  brand: string;
  aliases: string[];
  kind: 'national_chain' | 'regional_chain' | 'franchise';
  typeHints?: string[];
}

export interface ExceptionProfile {
  kind: ExceptionPolicyKind;
  discrepancyMultiplier: number;
  starPatternMultiplier: number;
  fakePraiseMultiplier: number;
  scoreCapWithoutCriticalEvidence: number | null;
  reason: string;
}

export interface ScoringContext {
  placeName: string;
  googleRating: number;
  estimatedRealRating: number;
  userRatingCount: number;
  reviewSampleCount: number;
  reviewDistributionSource: ReviewDistributionSource;
  primaryType?: string;
  types?: string[];
  categories?: string[];
  genre?: string;
  priceLevel?: string;
  priceRangeLabel?: string;
  chainStoreKeywordsRaw?: string;
  hasTabelogCitation?: boolean;
  estimatedRealRatingSource?: 'tabelog' | 'model_external' | 'model_only' | 'fallback';
}

export interface ScoreComputationResult {
  finalScore: number;
  scoreBeforeException: number;
  deterministicScore: number;
  componentScores: ComponentScores;
  confidence: 'low' | 'medium' | 'high';
  confidenceReasons: string[];
  exceptionPolicy: ExceptionPolicyResult;
  appliedFloors: string[];
  appliedCaps: string[];
  appliedMultipliers: string[];
}

const DEFAULT_CHAIN_BRANDS: ChainBrandDefinition[] = [
  { brand: 'サイゼリヤ', aliases: ['サイゼ', 'saizeriya'], kind: 'national_chain' },
  { brand: '松屋', aliases: ['matsuya'], kind: 'national_chain' },
  { brand: 'すき家', aliases: ['sukiya'], kind: 'national_chain' },
  { brand: '吉野家', aliases: ['yoshinoya'], kind: 'national_chain' },
  { brand: 'マクドナルド', aliases: ['マック', 'マクド', 'mcdonald'], kind: 'national_chain' },
  { brand: 'スターバックス', aliases: ['starbucks', 'スタバ'], kind: 'national_chain' },
  { brand: 'ドトール', aliases: ['doutor'], kind: 'national_chain' },
  { brand: 'タリーズ', aliases: ['tullys', 'tully'], kind: 'national_chain' },
  { brand: '鳥貴族', aliases: ['torikizoku'], kind: 'national_chain' },
  { brand: 'ガスト', aliases: ['gusto'], kind: 'national_chain' },
  { brand: 'バーミヤン', aliases: ['bamiyan'], kind: 'national_chain' },
  { brand: 'ジョナサン', aliases: ['jonathan'], kind: 'national_chain' },
  { brand: 'くら寿司', aliases: ['kurasushi'], kind: 'national_chain' },
  { brand: 'スシロー', aliases: ['sushiro'], kind: 'national_chain' },
  { brand: 'はま寿司', aliases: ['hamazushi'], kind: 'national_chain' },
  { brand: '一蘭', aliases: ['ichiran'], kind: 'national_chain' },
  { brand: '丸亀製麺', aliases: ['marugame'], kind: 'national_chain' },
  { brand: '餃子の王将', aliases: ['ohsho', '王将'], kind: 'national_chain' },
  { brand: 'コメダ珈琲', aliases: ['コメダ', 'komeda'], kind: 'national_chain' },
  { brand: 'モスバーガー', aliases: ['mosburger', 'mos'], kind: 'national_chain' },
  { brand: 'ケンタッキー', aliases: ['kfc', 'kentucky'], kind: 'national_chain' },
  { brand: 'ロイヤルホスト', aliases: ['royalhost'], kind: 'national_chain' },
];

const DEFAULT_EXCEPTION_PROFILE: ExceptionProfile = {
  kind: 'none',
  discrepancyMultiplier: 1,
  starPatternMultiplier: 1,
  fakePraiseMultiplier: 1,
  scoreCapWithoutCriticalEvidence: null,
  reason: '通常店舗として評価',
};

const EXCEPTION_PROFILES: Record<Exclude<ExceptionPolicyKind, 'none' | 'ambiguous_place_match'>, ExceptionProfile> = {
  national_chain: {
    kind: 'national_chain',
    discrepancyMultiplier: 0.35,
    starPatternMultiplier: 0.5,
    fakePraiseMultiplier: 0.6,
    scoreCapWithoutCriticalEvidence: 35,
    reason: '全国チェーンのため、評価乖離・短文高評価・星分布のfalse positiveを抑制',
  },
  regional_chain: {
    kind: 'regional_chain',
    discrepancyMultiplier: 0.5,
    starPatternMultiplier: 0.65,
    fakePraiseMultiplier: 0.75,
    scoreCapWithoutCriticalEvidence: 45,
    reason: '地域チェーンのため、評価乖離・星分布のfalse positiveを一部抑制',
  },
  franchise: {
    kind: 'franchise',
    discrepancyMultiplier: 0.6,
    starPatternMultiplier: 0.7,
    fakePraiseMultiplier: 0.8,
    scoreCapWithoutCriticalEvidence: 55,
    reason: 'フランチャイズ可能性があるため、チェーン補正は弱めに適用',
  },
  public_facility: {
    kind: 'public_facility',
    discrepancyMultiplier: 0.3,
    starPatternMultiplier: 0.5,
    fakePraiseMultiplier: 0.7,
    scoreCapWithoutCriticalEvidence: 35,
    reason: '公共施設・学食・社員食堂等はレビュー傾向が通常飲食店と異なるため補正',
  },
  hotel_or_department_restaurant: {
    kind: 'hotel_or_department_restaurant',
    discrepancyMultiplier: 0.6,
    starPatternMultiplier: 0.7,
    fakePraiseMultiplier: 0.8,
    scoreCapWithoutCriticalEvidence: 55,
    reason: 'ホテル・商業施設内店舗は施設レビューや価格帯の影響を受けるため補正',
  },
  low_review_new_store: {
    kind: 'low_review_new_store',
    discrepancyMultiplier: 0.75,
    starPatternMultiplier: 0.5,
    fakePraiseMultiplier: 0.7,
    scoreCapWithoutCriticalEvidence: 45,
    reason: 'レビュー件数が少ない新店・小規模店の可能性があるため、星分布や高評価を強い根拠にしない',
  },
  premium_or_course_restaurant: {
    kind: 'premium_or_course_restaurant',
    discrepancyMultiplier: 0.75,
    starPatternMultiplier: 0.85,
    fakePraiseMultiplier: 0.9,
    scoreCapWithoutCriticalEvidence: 60,
    reason: '高級店・コース料理店では高価格自体をリスク扱いしないため補正',
  },
  bar_or_izakaya_standard_charge: {
    kind: 'bar_or_izakaya_standard_charge',
    discrepancyMultiplier: 0.85,
    starPatternMultiplier: 0.9,
    fakePraiseMultiplier: 0.9,
    scoreCapWithoutCriticalEvidence: 60,
    reason: 'バー・居酒屋ではお通し・チャージが通常慣行の場合があるため単独では高リスクにしない',
  },
};

export function mapTabelogToGoogleEquivalent(tabelogRating: number): number {
  const t = clampNumber(tabelogRating, 2.0, 4.2);

  if (t <= 2.8) return lerp(t, 2.0, 2.8, 1.2, 1.9);
  if (t <= 3.0) return lerp(t, 2.8, 3.0, 1.9, 2.5);
  if (t <= 3.2) return lerp(t, 3.0, 3.2, 2.5, 3.4);
  if (t <= 3.4) return lerp(t, 3.2, 3.4, 3.4, 3.9);
  if (t <= 3.6) return lerp(t, 3.4, 3.6, 3.9, 4.3);
  if (t <= 3.8) return lerp(t, 3.6, 3.8, 4.3, 4.6);
  return lerp(t, 3.8, 4.2, 4.6, 4.9);
}

/**
 * @deprecated The final score is now computed by computeDeterministicSakuraScore.
 */
export function adjustRiskScoreByDiscrepancy(
  baseScore: number,
  googleRating: number,
  comparableRating: number,
  placeName: string,
  chainStoreKeywordsRaw?: string,
): number {
  const discrepancy = googleRating - comparableRating;
  if (discrepancy <= 0.4) return baseScore;

  let penalty = discrepancy <= 0.8 ? (discrepancy - 0.4) * 35 : 14 + (discrepancy - 0.8) * 50;

  if (looksLikeChainStore(placeName, chainStoreKeywordsRaw)) {
    penalty *= 0.6;
  }

  return clampScore(baseScore + penalty);
}

export function looksLikeChainStore(placeName: string, chainStoreKeywordsRaw?: string): boolean {
  const context: ScoringContext = {
    placeName,
    googleRating: 0,
    estimatedRealRating: 0,
    userRatingCount: 0,
    reviewSampleCount: 0,
    reviewDistributionSource: 'unavailable',
    chainStoreKeywordsRaw,
  };
  const profile = resolveExceptionProfile(context);
  return profile.kind === 'national_chain' || profile.kind === 'regional_chain' || profile.kind === 'franchise';
}

export function resolveChainStoreKeywords(rawValue: string | undefined): string[] {
  return resolveChainBrandDefinitions(rawValue).flatMap((definition) => [definition.brand, ...definition.aliases]);
}

export function resolveChainBrandDefinitions(rawValue?: string): ChainBrandDefinition[] {
  const additionalBrands = (rawValue || '')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((brand): ChainBrandDefinition => ({ brand, aliases: [], kind: 'national_chain' }));
  return mergeChainDefinitions([...DEFAULT_CHAIN_BRANDS, ...additionalBrands]);
}

export function normalizeBrandComparableName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000・･ー＿_()（）［］【】_-]/g, '')
    .replace(/\[|\]/g, '')
    .replace(/店$/g, '')
    .trim();
}

export function computeRatingGapRisk(googleRating: number, comparableRating: number): number {
  const discrepancy = googleRating - comparableRating;
  if (!Number.isFinite(discrepancy) || discrepancy <= 0.35) return 0;
  return clampScore(((discrepancy - 0.35) / 1.15) * 100);
}

export function computeStarPatternRisk(
  distribution: ReviewDistribution[],
  source: ReviewDistributionSource,
  reviewSampleCount: number,
): number {
  if (source === 'unavailable' || distribution.length === 0) return 0;

  const normalized = normalizeDistributionPercentages(distribution);
  const total = normalized.reduce((sum, item) => sum + item.percentage, 0);
  if (total <= 0) return 0;

  const percentOf = (star: number): number => normalized.find((item) => item.star === star)?.percentage || 0;
  const p1 = percentOf(1) / 100;
  const p2 = percentOf(2) / 100;
  const p3 = percentOf(3) / 100;
  const p4 = percentOf(4) / 100;
  const p5 = percentOf(5) / 100;

  const fiveStarSpike = clampNumber(((p5 - 0.7) / 0.2) * 100, 0, 100);
  const uShape = clampNumber((((p1 + p5) - (p2 + p3 + p4) - 0.2) / 0.4) * 100, 0, 100);
  const middleSuppression = clampNumber(((0.18 - (p2 + p3 + p4)) / 0.18) * 100, 0, 100);

  let cap = sourceRiskCap(source);
  if (reviewSampleCount < 3) cap = Math.min(cap, 10);
  else if (reviewSampleCount < 5) cap = Math.min(cap, 20);

  const risk = 0.45 * fiveStarSpike + 0.35 * uShape + 0.2 * middleSuppression;
  return clampScore(Math.min(risk, cap));
}

export function computeReviewTextRisk(signals: ComponentSignals): number {
  let risk =
    0.45 * signals.billingTroubleRisk +
    0.25 * signals.priceOpacityRisk +
    0.2 * signals.catchSalesRisk +
    0.1 * signals.fakePraiseRisk;

  if (signals.explicitBillingComplaintCount >= 2) {
    risk = Math.max(risk, 75);
  }
  if (signals.recentLowStarBillingComplaintCount >= 2) {
    risk = Math.max(risk, 70);
  }

  return clampScore(risk);
}

export function computeExternalComplaintRisk(signals: ComponentSignals, evidence: AnalysisEvidence[]): number {
  const externalEvidence = evidence.filter(
    (item) =>
      item.source === 'external_site' &&
      (item.category === 'billing_trouble' ||
        item.category === 'price_opacity' ||
        item.category === 'catch_sales' ||
        item.category === 'external_reputation'),
  );
  const maxExternalSeverity = externalEvidence.reduce((max, item) => Math.max(max, item.severity), 0);
  const base = externalEvidence.length > 0 ? signals.externalComplaintRisk : Math.min(signals.externalComplaintRisk, 60);
  return clampScore(Math.max(base, maxExternalSeverity));
}

export function computeLowInformationRisk(userRatingCount: number, reviewSampleCount: number): number {
  if (userRatingCount === 0) return 20;
  if (userRatingCount < 5) return 18;
  if (userRatingCount < 20 && reviewSampleCount < 3) return 12;
  if (userRatingCount < 20) return 8;
  return 0;
}

export function computeDeterministicSakuraScore(params: {
  signals: ComponentSignals;
  evidence: AnalysisEvidence[];
  reviewDistribution: ReviewDistribution[];
  context: ScoringContext;
}): ScoreComputationResult {
  const appliedFloors: string[] = [];
  const appliedCaps: string[] = [];
  const appliedMultipliers: string[] = [];

  const profile = resolveExceptionProfile(params.context);
  const rawReviewTextRisk = computeReviewTextRisk(params.signals);
  const rawRatingGapRisk = computeContextAwareRatingGapRisk(params.context);
  const rawStarPatternRisk = computeStarPatternRisk(
    params.reviewDistribution,
    params.context.reviewDistributionSource,
    params.context.reviewSampleCount,
  );
  const rawExternalComplaintRisk = computeExternalComplaintRisk(params.signals, params.evidence);
  const rawFakePraiseRisk = clampScore(params.signals.fakePraiseRisk);
  const lowInformationRisk = computeLowInformationRisk(params.context.userRatingCount, params.context.reviewSampleCount);

  const reviewTextRisk = rawReviewTextRisk;
  const externalComplaintRisk = rawExternalComplaintRisk;
  const ratingGapRisk = clampScore(rawRatingGapRisk * profile.discrepancyMultiplier);
  const starPatternRisk = clampScore(rawStarPatternRisk * profile.starPatternMultiplier);
  const fakePraiseRisk = clampScore(rawFakePraiseRisk * profile.fakePraiseMultiplier);

  if (profile.discrepancyMultiplier !== 1) {
    appliedMultipliers.push(`rating_gap_${profile.discrepancyMultiplier}`);
  }
  if (profile.starPatternMultiplier !== 1) {
    appliedMultipliers.push(`star_pattern_${profile.starPatternMultiplier}`);
  }
  if (profile.fakePraiseMultiplier !== 1) {
    appliedMultipliers.push(`fake_praise_${profile.fakePraiseMultiplier}`);
  }

  const componentScores: ComponentScores = {
    reviewTextRisk,
    ratingGapRisk,
    starPatternRisk,
    externalComplaintRisk,
    fakePraiseRisk,
    lowInformationRisk,
  };

  let score = Math.round(
    0.4 * reviewTextRisk + 0.25 * ratingGapRisk + 0.2 * starPatternRisk + 0.15 * externalComplaintRisk,
  );

  if (fakePraiseRisk >= 75 && starPatternRisk >= 50) {
    score += 8;
  }

  score = clampScore(score);
  const deterministicScore = score;

  const hasTextEvidence = reviewTextRisk >= 40;
  const hasExternalEvidence = externalComplaintRisk >= 40;
  const criticalEvidence = hasCriticalEvidence(params.signals, componentScores);

  if (params.signals.explicitBillingComplaintCount >= 2) {
    score = Math.max(score, 75);
    appliedFloors.push('explicit_billing_complaints_2_or_more');
  }

  if (params.signals.explicitBillingComplaintCount >= 1 && (ratingGapRisk >= 50 || externalComplaintRisk >= 50)) {
    score = Math.max(score, 65);
    appliedFloors.push('billing_complaint_with_gap_or_external_signal');
  }

  if (params.signals.explicitBillingComplaintCount >= 1 && params.signals.priceOpacityRisk >= 70) {
    score = Math.max(score, 55);
    appliedFloors.push('billing_complaint_with_price_opacity');
  }

  if (params.signals.recentLowStarBillingComplaintCount >= 2) {
    score = Math.max(score, 70);
    appliedFloors.push('recent_low_star_billing_complaints_2_or_more');
  }

  if (externalComplaintRisk >= 80) {
    score = Math.max(score, 70);
    appliedFloors.push('strong_external_complaint');
  }

  if (params.signals.catchSalesRisk >= 80 && params.signals.priceOpacityRisk >= 60) {
    score = Math.max(score, 70);
    appliedFloors.push('catch_sales_with_price_opacity');
  }

  const onlyStarPatternEvidence =
    starPatternRisk >= 40 && reviewTextRisk < 30 && externalComplaintRisk < 30 && ratingGapRisk < 50;

  if (onlyStarPatternEvidence) {
    score = Math.min(score, 55);
    appliedCaps.push('only_star_pattern_evidence');
  }

  if (!hasTextEvidence && !hasExternalEvidence && ratingGapRisk < 50) {
    score = Math.min(score, 35);
    appliedCaps.push('no_text_or_external_evidence');
  }

  if (params.context.reviewSampleCount < 3 && !hasExternalEvidence && !criticalEvidence) {
    score = Math.min(score, 40);
    appliedCaps.push('very_small_review_sample_without_external_evidence');
  }

  if (params.context.userRatingCount < 5 && !criticalEvidence) {
    score = Math.min(score, 45);
    appliedCaps.push('very_low_review_count_without_critical_evidence');
  }

  const scoreBeforeException = clampScore(score);

  if (profile.scoreCapWithoutCriticalEvidence !== null && !criticalEvidence) {
    const capped = Math.min(score, profile.scoreCapWithoutCriticalEvidence);
    if (capped !== score) {
      score = capped;
      appliedCaps.push(`exception_${profile.kind}_cap_${profile.scoreCapWithoutCriticalEvidence}`);
    }
  }

  score = clampScore(score);

  const confidenceResult = deriveConfidence({
    userRatingCount: params.context.userRatingCount,
    reviewSampleCount: params.context.reviewSampleCount,
    evidenceCount: params.evidence.length,
    externalEvidenceCount: params.evidence.filter((item) => item.source === 'external_site').length,
    hasTabelogCitation: Boolean(params.context.hasTabelogCitation),
    hasCriticalEvidence: criticalEvidence,
    reviewDistributionSource: params.context.reviewDistributionSource,
  });

  return {
    finalScore: score,
    scoreBeforeException,
    deterministicScore,
    componentScores,
    confidence: confidenceResult.confidence,
    confidenceReasons: confidenceResult.reasons,
    exceptionPolicy: {
      applied: profile.kind !== 'none' && score !== scoreBeforeException,
      kind: profile.kind,
      reason: profile.reason,
      originalScore: scoreBeforeException,
      adjustedScore: score,
    },
    appliedFloors,
    appliedCaps,
    appliedMultipliers,
  };
}

export function hasCriticalEvidence(signals: ComponentSignals, componentScores: ComponentScores): boolean {
  return (
    signals.explicitBillingComplaintCount >= 2 ||
    signals.recentLowStarBillingComplaintCount >= 2 ||
    componentScores.externalComplaintRisk >= 70 ||
    componentScores.reviewTextRisk >= 75 ||
    (signals.catchSalesRisk >= 80 && signals.priceOpacityRisk >= 60)
  );
}

export function deriveConfidence(params: {
  userRatingCount: number;
  reviewSampleCount: number;
  evidenceCount: number;
  externalEvidenceCount: number;
  hasTabelogCitation: boolean;
  hasCriticalEvidence: boolean;
  reviewDistributionSource?: ReviewDistributionSource;
}): { confidence: 'low' | 'medium' | 'high'; reasons: string[] } {
  const reasons: string[] = [];
  let rank = 1;

  if (params.userRatingCount < 5) {
    rank = 0;
    reasons.push('Googleレビュー件数が少ないため判定信頼度は低めです。');
  } else if (params.reviewSampleCount < 3 && params.externalEvidenceCount === 0) {
    rank = 0;
    reasons.push('レビュー本文サンプルが少なく、外部サイトの確認情報も限定的です。');
  } else if (params.userRatingCount >= 100 && params.reviewSampleCount >= 5) {
    rank = Math.max(rank, 1);
    reasons.push('Googleレビュー件数とレビュー本文サンプルが一定数あります。');
  }

  if (params.externalEvidenceCount > 0) {
    rank = Math.max(rank, 1);
    reasons.push('外部サイトの確認情報があるため判定信頼度を引き上げました。');
  }

  if (params.hasTabelogCitation) {
    rank = Math.max(rank, 1);
    reasons.push('食べログの参照確認情報があるため評価乖離の信頼度を補強しています。');
  }

  if (params.hasCriticalEvidence && params.evidenceCount >= 2) {
    rank = 2;
    reasons.push('明確な会計・料金トラブルの記述が複数あるため判定信頼度は高めです。');
  }

  if (params.reviewDistributionSource === 'model_estimated') {
    if (rank > 0) rank -= 1;
    reasons.push('星分布はモデル推定のため、判定根拠としては弱めに扱っています。');
  }

  if (reasons.length === 0) {
    reasons.push('取得できたレビュー情報と外部評判をもとに判定しています。');
  }

  return {
    confidence: rank >= 2 ? 'high' : rank >= 1 ? 'medium' : 'low',
    reasons,
  };
}

export function resolveExceptionProfile(context: ScoringContext): ExceptionProfile {
  if (looksLikePublicFacility(context)) return EXCEPTION_PROFILES.public_facility;

  const chainMatch = findChainBrandMatch(context.placeName, context.chainStoreKeywordsRaw);
  if (chainMatch) return EXCEPTION_PROFILES[chainMatch.kind];

  if (looksLikeHotelOrDepartmentRestaurant(context)) return EXCEPTION_PROFILES.hotel_or_department_restaurant;
  if (context.userRatingCount < 20 && context.googleRating >= 4.4) return EXCEPTION_PROFILES.low_review_new_store;
  if (looksLikePremiumOrCourseRestaurant(context)) return EXCEPTION_PROFILES.premium_or_course_restaurant;
  if (looksLikeBarOrIzakaya(context)) return EXCEPTION_PROFILES.bar_or_izakaya_standard_charge;

  return DEFAULT_EXCEPTION_PROFILE;
}

export function verdictToMinScore(verdict: '安全' | '注意' | '危険'): number {
  if (verdict === '危険') return 70;
  if (verdict === '注意') return 40;
  return 0;
}

export function deriveVerdict(score: number): '安全' | '注意' | '危険' {
  if (score >= 70) return '危険';
  if (score >= 40) return '注意';
  return '安全';
}

function computeContextAwareRatingGapRisk(context: ScoringContext): number {
  const base = computeRatingGapRisk(context.googleRating, context.estimatedRealRating);
  if (context.estimatedRealRatingSource === 'fallback') return 0;
  if (context.estimatedRealRatingSource === 'model_only') return clampScore(base * 0.5);
  return base;
}

function sourceRiskCap(source: ReviewDistributionSource): number {
  if (source === 'model_estimated') return 20;
  if (source === 'google_review_sample') return 35;
  if (source === 'external_site') return 50;
  if (source === 'google_aggregate') return 100;
  return 0;
}

function normalizeDistributionPercentages(distribution: ReviewDistribution[]): ReviewDistribution[] {
  const byStar = new Map<number, number>();
  for (const item of distribution) {
    const star = Math.round(item.star);
    const percentage = Number.isFinite(item.percentage) ? Math.max(0, item.percentage) : 0;
    if (star < 1 || star > 5) continue;
    byStar.set(star, percentage);
  }

  const total = Array.from(byStar.values()).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];

  return [1, 2, 3, 4, 5].map((star) => ({
    star,
    percentage: (byStar.get(star) || 0) * (100 / total),
  }));
}

function findChainBrandMatch(placeName: string, rawValue?: string): ChainBrandDefinition | null {
  const normalizedName = normalizeBrandComparableName(placeName);
  if (!normalizedName) return null;

  for (const definition of resolveChainBrandDefinitions(rawValue)) {
    const names = [definition.brand, ...definition.aliases].map(normalizeBrandComparableName).filter(Boolean);
    if (names.some((name) => name.length > 0 && normalizedName.includes(name))) {
      return definition;
    }
  }
  return null;
}

function mergeChainDefinitions(definitions: ChainBrandDefinition[]): ChainBrandDefinition[] {
  const byKey = new Map<string, ChainBrandDefinition>();
  for (const definition of definitions) {
    const key = normalizeBrandComparableName(definition.brand);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...definition, aliases: [...definition.aliases] });
      continue;
    }
    existing.aliases = Array.from(new Set([...existing.aliases, ...definition.aliases]));
  }
  return Array.from(byKey.values());
}

function looksLikePublicFacility(context: ScoringContext): boolean {
  const text = contextText(context);
  const strongPublic = ['大学', '病院', '庁舎', '市役所', '区役所', 'キャンパス', '役所', '公共'];
  if (strongPublic.some((keyword) => text.includes(keyword))) return true;
  const cafeteria = ['学食', '学生食堂', '社員食堂'];
  if (cafeteria.some((keyword) => text.includes(keyword))) return true;
  return text.includes('食堂') && strongPublic.some((keyword) => text.includes(keyword));
}

function looksLikeHotelOrDepartmentRestaurant(context: ScoringContext): boolean {
  const text = contextText(context);
  return ['ホテル', 'hotel', '百貨店', 'デパート', 'モール', 'mall', '駅ビル', 'ルミネ', 'アトレ', 'パルコ', 'parco', 'イオン', 'aeon'].some(
    (keyword) => text.includes(keyword),
  );
}

function looksLikePremiumOrCourseRestaurant(context: ScoringContext): boolean {
  const text = contextText(context);
  if (context.priceLevel === 'PRICE_LEVEL_EXPENSIVE' || context.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE') {
    return true;
  }
  return ['fine_dining_restaurant', 'フレンチ', '寿司', '鮨', '日本料理', 'コース', '懐石'].some((keyword) =>
    text.includes(keyword.toLowerCase()),
  );
}

function looksLikeBarOrIzakaya(context: ScoringContext): boolean {
  const text = contextText(context);
  return ['bar', 'pub', 'wine_bar', 'japanese_izakaya_restaurant', 'izakaya_restaurant', 'バー', '居酒屋'].some(
    (keyword) => text.includes(keyword.toLowerCase()),
  );
}

function contextText(context: ScoringContext): string {
  return [
    context.placeName,
    context.primaryType,
    ...(context.types || []),
    ...(context.categories || []),
    context.genre,
    context.priceRangeLabel,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .normalize('NFKC')
    .toLowerCase();
}

function lerp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax <= inMin) return outMin;
  const ratio = clampNumber((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * ratio;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clampNumber(value, 0, 100));
}

/**
 * Fallback heuristic used only when LLM does not provide structured signals.
 */
export function inferScoreFromText(summary: string): number {
  const normalized = summary.normalize('NFKC');
  const asciiLower = normalized.toLowerCase();
  if (normalized.includes('サクラ') || normalized.includes('詐欺') || asciiLower.includes('scam')) return 75;
  if (normalized.includes('注意') || normalized.includes('不自然') || asciiLower.includes('suspicious')) return 50;
  return 30;
}
