import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { analyzePlace } from '../services/apiService';
import { AnalysisReport } from '../types';

vi.mock('../services/apiService', () => ({
  analyzePlace: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
      model: 'google/gemini-3-flash-preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      budgetState: 'ok',
    },
  };
}
