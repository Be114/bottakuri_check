import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { analyzePlace, fetchNearbyRanking } from '../services/apiService';
import { AnalysisReport, NearbyRankingReport } from '../types';

vi.mock('../services/apiService', () => ({
  API_BASE_URL: 'https://bottakuri-check-api.steep-wood-db4a.workers.dev/api',
  analyzePlace: vi.fn(),
  fetchNearbyRanking: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App loading state', () => {
  it('shows indeterminate loading message while analysis request is pending', async () => {
    vi.mocked(analyzePlace).mockImplementation(
      () =>
        new Promise(() => {
          // Keep pending to verify loading UI.
        }),
    );

    render(<App />);

    const input = screen.getByLabelText('店舗検索入力');
    fireEvent.change(input, { target: { value: '新宿 居酒屋' } });

    const form = input.closest('form');
    if (!form) {
      throw new Error('form element not found');
    }

    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    fireEvent.submit(form);

    expect(await screen.findByText('お店の情報を分析しています...')).toBeInTheDocument();
    expect(
      screen.getByText('Googleマップ情報の取得とAI分析を実行中です。完了までこのままお待ちください。'),
    ).toBeInTheDocument();
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 1200)).toBe(false);

    setTimeoutSpy.mockRestore();
  });

  it('shows analysis results when the API succeeds', async () => {
    vi.mocked(analyzePlace).mockResolvedValue(buildReport());

    render(<App />);

    submitSearch('新宿 居酒屋');

    expect(await screen.findByText('検証店舗')).toBeInTheDocument();
    expect(screen.getByText('東京都新宿区')).toBeInTheDocument();
  });

  it('shows mapped API error messages when the API fails', async () => {
    vi.mocked(analyzePlace).mockRejectedValue({
      code: 'RATE_LIMIT',
      message: 'raw rate limit message',
    });

    render(<App />);

    submitSearch('新宿 居酒屋');

    expect(
      await screen.findByText('アクセスが集中しています。少し時間をおいて再度お試しください。'),
    ).toBeInTheDocument();
  });

  it('shows geolocation errors from the nearby origin dialog', async () => {
    vi.mocked(analyzePlace).mockResolvedValue(buildReport());
    vi.stubGlobal('navigator', { geolocation: undefined });

    render(<App />);

    submitSearch('新宿 居酒屋');

    expect(await screen.findByText('検証店舗')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /近くの優良店を探す/ }));
    expect(screen.getAllByText('位置情報を起点にします').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /現在位置/ }));

    expect(await screen.findByText('このブラウザは現在位置の取得に対応していません。')).toBeInTheDocument();
  });

  it('opens nearby ranking from current location and hides the nearby CTA on that screen', async () => {
    vi.mocked(analyzePlace).mockResolvedValue(buildReport());
    vi.mocked(fetchNearbyRanking).mockResolvedValue(buildNearbyReport());
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((success: PositionCallback) =>
          success({
            coords: {
              latitude: 35.681236,
              longitude: 139.767125,
              accuracy: 10,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
        ),
      },
    });

    render(<App />);

    submitSearch('新宿 居酒屋');
    expect(await screen.findByText('検証店舗')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /近くの優良店を探す/ }));
    fireEvent.click(screen.getByRole('button', { name: /現在位置/ }));

    expect(await screen.findByText('周辺の優良店ランキング')).toBeInTheDocument();
    expect(screen.getAllByText('優良店A').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /元の1店舗分析へ戻る/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /近くの優良店を探す/ })).not.toBeInTheDocument();
  });

  it('passes structured origin genre and categories to nearby ranking requests', async () => {
    vi.mocked(analyzePlace).mockResolvedValue(buildReport());
    vi.mocked(fetchNearbyRanking).mockResolvedValue(buildNearbyReport());

    render(<App />);

    submitSearch('新宿 居酒屋');
    expect(await screen.findByText('検証店舗')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /近くの優良店を探す/ }));
    fireEvent.click(screen.getByRole('button', { name: /分析した店/ }));

    expect(await screen.findByText('周辺の優良店ランキング')).toBeInTheDocument();
    expect(fetchNearbyRanking).toHaveBeenCalledWith(
      expect.objectContaining({
        location: { lat: 35.6895, lng: 139.6917 },
        originType: 'analyzed_place',
        originPlaceName: '検証店舗',
        originAddress: '東京都新宿区',
        originGenre: '居酒屋',
        originCategories: ['焼き鳥', '個室居酒屋', '和食'],
      }),
    );
  });
});

function submitSearch(value: string): void {
  const input = screen.getByLabelText('店舗検索入力');
  fireEvent.change(input, { target: { value } });

  const form = input.closest('form');
  if (!form) {
    throw new Error('form element not found');
  }

  fireEvent.submit(form);
}

function buildReport(): AnalysisReport {
  return {
    placeName: '検証店舗',
    address: '東京都新宿区',
    location: { lat: 35.6895, lng: 139.6917 },
    category: '和食',
    categories: ['焼き鳥', '個室居酒屋'],
    genre: '居酒屋',
    metadata: {
      category: '和食',
      categories: ['個室居酒屋'],
      genre: '居酒屋',
    },
    sakuraScore: 25,
    estimatedRealRating: 3.8,
    googleRating: 3.9,
    verdict: '安全',
    risks: [{ category: '評価乖離', riskLevel: 'low', description: '目立った乖離はありません。' }],
    suspiciousKeywordsFound: [],
    summary: '目立ったリスクは見つかりませんでした。',
    reviewDistribution: [
      { star: 1, percentage: 5 },
      { star: 2, percentage: 10 },
      { star: 3, percentage: 20 },
      { star: 4, percentage: 35 },
      { star: 5, percentage: 30 },
    ],
    groundingUrls: [],
    meta: {
      cached: false,
      model: 'google/gemini-3.1-flash-lite-preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      budgetState: 'ok',
    },
  };
}

function buildNearbyReport(): NearbyRankingReport {
  return {
    origin: {
      type: 'current_location',
      location: { lat: 35.681236, lng: 139.767125 },
      placeName: '検証店舗',
      address: '東京都新宿区',
    },
    places: Array.from({ length: 4 }, (_, index) => ({
      id: `place-${index + 1}`,
      placeId: `place-${index + 1}`,
      rank: index + 1,
      name: index === 0 ? '優良店A' : `優良店${index + 1}`,
      genre: '和食',
      placeName: index === 0 ? '優良店A' : `優良店${index + 1}`,
      address: '東京都千代田区',
      location: { lat: 35.68 + index * 0.001, lng: 139.76 + index * 0.001 },
      mapUrl: 'https://maps.example.com',
      googleRating: 4.2,
      estimatedRealRating: 4.1,
      userRatingCount: 100,
      trustScore: 88 - index * 3,
      sakuraScore: 12 + index,
      suspicionLevel: 'low' as const,
      verdict: '安全',
      reviewCount: 100,
      distanceMeters: 200 + index * 100,
      categories: ['和食'],
      summary: '評価が安定している候補です。',
      reasons: ['評価が安定'],
    })),
    meta: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      originType: 'current_location',
      originPlaceName: '検証店舗',
      originAddress: '東京都新宿区',
    },
  };
}
