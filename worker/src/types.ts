export interface Env {
  APP_KV: KVNamespace;
  COUNTERS: DurableObjectNamespace;
  OPENROUTER_API_KEY: string;
  GOOGLE_PLACES_API_KEY: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
  ALLOWED_ORIGINS?: string;
  DAILY_BUDGET_USD?: string;
  WORST_CASE_COST_USD?: string;
  CACHE_TTL_SECONDS?: string;
  PER_MINUTE_LIMIT?: string;
  PER_DAY_NEW_ANALYSIS_LIMIT?: string;
  OPENROUTER_MAX_TOKENS?: string;
  OPENROUTER_WEB_MAX_RESULTS?: string;
  REVIEW_SAMPLE_LIMIT?: string;
  DAY_ROLLOVER_TIMEZONE?: string;
  CHAIN_STORE_KEYWORDS?: string;
  NEARBY_RANKINGS_PER_MINUTE_LIMIT?: string;
  NEARBY_RANKINGS_PER_DAY_LIMIT?: string;
  NEARBY_RANKINGS_DAILY_CAP?: string;
  NEARBY_RANKINGS_DISABLE_BUDGET_LIMIT?: string;
  NEARBY_ANALYSIS_CONCURRENCY?: string;
  NEARBY_ANALYSIS_REVIEW_SAMPLE_LIMIT?: string;
}

export type ErrorCode = 'INVALID_QUERY' | 'RATE_LIMIT' | 'BUDGET_EXCEEDED' | 'MODEL_UNAVAILABLE' | 'UPSTREAM_ERROR';

export type BudgetState = 'ok' | 'capped';

export interface AnalysisRisk {
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
}

export interface ReviewDistribution {
  star: number;
  percentage: number;
}

export type ReviewDistributionSource =
  | 'google_aggregate'
  | 'google_review_sample'
  | 'external_site'
  | 'model_estimated'
  | 'unavailable';

export interface AnalysisEvidence {
  category:
    | 'billing_trouble'
    | 'price_opacity'
    | 'catch_sales'
    | 'fake_praise'
    | 'review_distribution'
    | 'rating_gap'
    | 'external_reputation'
    | 'low_information'
    | 'place_exception'
    | 'other';
  severity: number;
  source: 'google_review_sample' | 'external_site' | 'model' | 'deterministic_rule' | 'place_metadata';
  snippet?: string;
  description: string;
}

export interface ComponentSignals {
  reviewTextRisk: number;
  fakePraiseRisk: number;
  externalComplaintRisk: number;
  priceOpacityRisk: number;
  catchSalesRisk: number;
  billingTroubleRisk: number;
  starPatternRiskObservation: number;
  criticalComplaintCount: number;
  explicitBillingComplaintCount: number;
  recentLowStarBillingComplaintCount: number;
}

export interface ComponentScores {
  reviewTextRisk: number;
  ratingGapRisk: number;
  starPatternRisk: number;
  externalComplaintRisk: number;
  fakePraiseRisk: number;
  lowInformationRisk: number;
}

export type ExceptionPolicyKind =
  | 'none'
  | 'national_chain'
  | 'regional_chain'
  | 'franchise'
  | 'public_facility'
  | 'hotel_or_department_restaurant'
  | 'low_review_new_store'
  | 'premium_or_course_restaurant'
  | 'bar_or_izakaya_standard_charge'
  | 'ambiguous_place_match';

export interface ExceptionPolicyResult {
  applied: boolean;
  kind: ExceptionPolicyKind;
  reason: string;
  originalScore: number;
  adjustedScore: number;
}

export interface GroundingUrl {
  title: string;
  uri: string;
}

export interface AnalysisReport {
  placeName: string;
  address: string;
  location?: {
    lat: number;
    lng: number;
  };
  category?: string;
  categories?: string[];
  genre?: string;
  metadata?: {
    category?: string;
    categories?: string[];
    genre?: string;
    [key: string]: unknown;
  };
  sakuraScore: number;
  estimatedRealRating: number;
  estimatedRealRatingSource?: 'tabelog' | 'model_external' | 'model_only' | 'fallback';
  googleRating: number;
  tabelogRating?: number;
  verdict: '安全' | '注意' | '危険';
  confidence?: 'low' | 'medium' | 'high';
  confidenceReasons?: string[];
  componentScores?: ComponentScores;
  scoringDebug?: {
    rawModelScore?: number;
    deterministicScore: number;
    scoreBeforeException: number;
    finalScore: number;
    appliedFloors: string[];
    appliedCaps: string[];
    appliedMultipliers: string[];
  };
  exceptionPolicy?: ExceptionPolicyResult;
  risks: AnalysisRisk[];
  suspiciousKeywordsFound: string[];
  summary: string;
  reviewDistribution: ReviewDistribution[];
  reviewDistributionSource?: ReviewDistributionSource;
  evidence?: AnalysisEvidence[];
  groundingUrls: GroundingUrl[];
  meta: {
    cached: boolean;
    model: string;
    generatedAt: string;
    budgetState: BudgetState;
    scoringVersion?: number;
  };
}

export interface AnalyzeRequest {
  query?: unknown;
  location?: {
    lat?: unknown;
    lng?: unknown;
  };
}

export interface NearbyRankingsRequest {
  originPlaceName?: unknown;
  originAddress?: unknown;
  originGenre?: unknown;
  originCategories?: unknown;
  location?: {
    lat?: unknown;
    lng?: unknown;
  };
  radiusMeters?: unknown;
}

export interface PlaceReview {
  rating: number;
  text: string;
  authorName?: string;
  publishTime?: string;
}

export type PlacePriceLevel =
  | 'PRICE_LEVEL_UNSPECIFIED'
  | 'PRICE_LEVEL_FREE'
  | 'PRICE_LEVEL_INEXPENSIVE'
  | 'PRICE_LEVEL_MODERATE'
  | 'PRICE_LEVEL_EXPENSIVE'
  | 'PRICE_LEVEL_VERY_EXPENSIVE';

export interface PlaceMoney {
  currencyCode?: string;
  units?: string;
  nanos?: number;
}

export interface PlacePriceRange {
  startPrice?: PlaceMoney;
  endPrice?: PlaceMoney;
}

export interface PlaceData {
  placeId: string;
  name: string;
  address: string;
  genre?: string;
  primaryType?: string;
  types: string[];
  categories: string[];
  googleRating: number;
  userRatingCount: number;
  priceLevel?: PlacePriceLevel;
  priceRange?: PlacePriceRange;
  reviews: PlaceReview[];
  reviewSampleCount?: number;
  reviewDistributionSample?: ReviewDistribution[];
  location?: {
    lat: number;
    lng: number;
  };
}

export interface NearbyPlaceData {
  placeId: string;
  name: string;
  genre: string;
  primaryType?: string;
  types: string[];
  categories: string[];
  address: string;
  googleRating: number;
  userRatingCount: number;
  priceLevel?: PlacePriceLevel;
  priceRange?: PlacePriceRange;
  location: {
    lat: number;
    lng: number;
  };
  distanceMeters: number;
}

export type SuspicionLevel = 'low' | 'medium' | 'high';

export interface NearbyRanking {
  rank: number;
  placeId: string;
  name: string;
  genre: string;
  placeName: string;
  address: string;
  location: {
    lat: number;
    lng: number;
  };
  distanceMeters: number;
  googleRating: number;
  userRatingCount: number;
  priceLevel?: PlacePriceLevel;
  priceRange?: PlacePriceRange;
  estimatedRealRating: number;
  trustScore: number;
  sakuraScore: number;
  suspicionLevel: SuspicionLevel;
  verdict: '安全' | '注意' | '危険';
  summary: string;
  reasons: string[];
  categories: string[];
  mapUrl: string;
  analysisReport: AnalysisReport;
}

export interface NearbyRankingsResponse {
  origin: {
    placeName: string;
    address?: string;
    location: {
      lat: number;
      lng: number;
    };
    radiusMeters: number;
    genre?: string;
    categories?: string[];
  };
  rankings: NearbyRanking[];
  topPins: NearbyRanking[];
  mapImageUrl?: string;
  mapEmbedUrl: string;
  meta: {
    cached: boolean;
    model: string;
    generatedAt: string;
    budgetState: BudgetState;
    candidatesCount: number;
    analyzedCount: number;
    warnings: string[];
    genreFilter?: string[];
  };
}

export interface OpenRouterAnnotation {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
  };
}

export interface OpenRouterMessageContentPart {
  type?: string;
  text?: string;
}

export interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | OpenRouterMessageContentPart[];
      annotations?: OpenRouterAnnotation[];
    };
  }>;
  error?: {
    message?: string;
  };
}
