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
  REVIEW_SAMPLE_LIMIT?: string;
  DAY_ROLLOVER_TIMEZONE?: string;
  CHAIN_STORE_KEYWORDS?: string;
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

export interface GroundingUrl {
  title: string;
  uri: string;
}

export interface AnalysisReport {
  placeName: string;
  address: string;
  sakuraScore: number;
  estimatedRealRating: number;
  googleRating: number;
  tabelogRating?: number;
  verdict: '安全' | '注意' | '危険';
  risks: AnalysisRisk[];
  suspiciousKeywordsFound: string[];
  summary: string;
  reviewDistribution: ReviewDistribution[];
  groundingUrls: GroundingUrl[];
  meta: {
    cached: boolean;
    model: string;
    generatedAt: string;
    budgetState: BudgetState;
  };
}

export interface AnalyzeRequest {
  query?: unknown;
  location?: {
    lat?: unknown;
    lng?: unknown;
  };
}

export interface PlaceReview {
  rating: number;
  text: string;
  authorName?: string;
  publishTime?: string;
}

export interface PlaceData {
  placeId: string;
  name: string;
  address: string;
  googleRating: number;
  userRatingCount: number;
  reviews: PlaceReview[];
  location?: {
    lat: number;
    lng: number;
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
