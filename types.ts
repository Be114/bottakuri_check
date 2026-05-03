export interface AnalysisRisk {
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
}

export interface ReviewSource {
  platform: string;
  rating: number;
  reviewCount?: number;
  url?: string;
}

export type BudgetState = 'ok' | 'capped';

export interface AnalysisMeta {
  cached: boolean;
  model: string;
  generatedAt: string;
  budgetState: BudgetState;
}

export interface AnalysisMetadata {
  category?: string;
  categories?: string[];
  genre?: string;
  [key: string]: unknown;
}

export type ApiErrorCode = 'INVALID_QUERY' | 'RATE_LIMIT' | 'BUDGET_EXCEEDED' | 'MODEL_UNAVAILABLE' | 'UPSTREAM_ERROR';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  status?: number;
}

export interface LocationCoordinates {
  lat: number;
  lng: number;
}

export interface AnalysisReport {
  placeName: string;
  address: string;
  location?: LocationCoordinates;
  category?: string;
  categories?: string[];
  genre?: string;
  metadata?: AnalysisMetadata;
  sakuraScore: number; // 0 to 100, where 100 is confirmed fake/sakura, 0 is safe.
  estimatedRealRating: number;
  googleRating: number;
  tabelogRating?: number; // Optional, might not be found
  verdict: string; // "Safe", "Suspicious", "Danger"
  risks: AnalysisRisk[];
  suspiciousKeywordsFound: string[];
  summary: string;
  reviewDistribution: {
    star: number;
    percentage: number;
  }[];
  groundingUrls: { title: string; uri: string }[];
  meta: AnalysisMeta;
}

export interface SearchState {
  isLoading: boolean;
  step: 'idle' | 'searching' | 'analyzing' | 'complete' | 'error';
  message: string;
  data?: AnalysisReport;
  errorCode?: ApiErrorCode;
}

export type NearbyOriginType = 'current_location' | 'analyzed_place';

export interface NearbyRankingRequest {
  location: LocationCoordinates;
  originType: NearbyOriginType;
  originPlaceName?: string;
  originAddress?: string;
  originGenre?: string;
  originCategories?: string[];
  radiusMeters?: number;
}

export interface NearbyPlace {
  id: string;
  placeId: string;
  rank: number;
  name: string;
  genre: string;
  placeName: string;
  address: string;
  location?: LocationCoordinates;
  mapUrl?: string;
  googleRating: number;
  estimatedRealRating: number;
  priceLevel?: number;
  priceRange?: string;
  userRatingCount?: number;
  trustScore: number;
  sakuraScore: number;
  suspicionLevel: 'low' | 'medium' | 'high' | 'very_high';
  verdict: string;
  reviewCount?: number;
  distanceMeters?: number;
  categories: string[];
  summary: string;
  reasons: string[];
  analysisReport?: AnalysisReport;
}

export interface NearbyRankingMeta {
  generatedAt: string;
  originType: NearbyOriginType;
  originPlaceName?: string;
  originAddress?: string;
  originGenre?: string;
  originCategories?: string[];
  cached?: boolean;
  model?: string;
  budgetState?: BudgetState;
  candidatesCount?: number;
  analyzedCount?: number;
  warnings?: string[];
  genreFilter?: string[];
}

export interface NearbyRankingReport {
  mapImageUrl?: string;
  mapEmbedUrl?: string;
  origin: {
    location: LocationCoordinates;
    type: NearbyOriginType;
    placeName?: string;
    address?: string;
    genre?: string;
    categories?: string[];
    radiusMeters?: number;
  };
  places: NearbyPlace[];
  meta: NearbyRankingMeta;
}
