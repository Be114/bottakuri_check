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

export interface AnalysisReport {
  placeName: string;
  address: string;
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
}

export interface SearchState {
  isLoading: boolean;
  step: 'idle' | 'searching' | 'analyzing' | 'complete' | 'error';
  message: string;
  data?: AnalysisReport;
}