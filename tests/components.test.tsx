import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AnalysisDashboard from '../components/AnalysisDashboard';
import ReviewChart from '../components/ReviewChart';
import ScoreGauge from '../components/ScoreGauge';
import { AnalysisReport } from '../types';

afterEach(() => {
  cleanup();
});

describe('ScoreGauge', () => {
  it('clamps scores and derives a fallback verdict', () => {
    render(<ScoreGauge score={120} verdict="" />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('危険')).toBeInTheDocument();
  });
});

describe('ReviewChart', () => {
  it('sorts and bounds visible review distribution values', () => {
    render(
      <ReviewChart
        data={[
          { star: 5, percentage: 120 },
          { star: 1, percentage: -10 },
          { star: 3, percentage: 24.6 },
        ]}
      />,
    );

    expect(screen.getByText('★1')).toBeInTheDocument();
    expect(screen.getByText('★3')).toBeInTheDocument();
    expect(screen.getByText('★5')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});

describe('AnalysisDashboard', () => {
  it('renders core report fields and safe external source links', () => {
    const onReset = vi.fn();
    render(<AnalysisDashboard data={buildReport()} onReset={onReset} />);

    expect(screen.getByText('検証店舗')).toBeInTheDocument();
    expect(screen.getByText('東京都新宿区')).toBeInTheDocument();
    expect(screen.getByText('サクラ危険度')).toBeInTheDocument();
    expect(screen.getByText('判定詳細レポート')).toBeInTheDocument();
    expect(screen.getByText('目立ったリスクはありません。')).toBeInTheDocument();

    const sourceLink = screen.getByRole('link', { name: /Google Maps/ });
    expect(sourceLink).toHaveAttribute('href', 'https://www.google.com/maps/place/?q=place_id:place-id');
    expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(screen.getByRole('button', { name: /別の場所を検索/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

function buildReport(): AnalysisReport {
  return {
    placeName: '検証店舗',
    address: '東京都新宿区',
    sakuraScore: 20,
    estimatedRealRating: 3.8,
    googleRating: 3.9,
    verdict: '安全',
    risks: [{ category: '総合', riskLevel: 'low', description: '目立ったリスクはありません。' }],
    suspiciousKeywordsFound: ['高評価'],
    summary: '比較的信頼できる評価分布です。',
    reviewDistribution: [
      { star: 1, percentage: 5 },
      { star: 2, percentage: 10 },
      { star: 3, percentage: 20 },
      { star: 4, percentage: 35 },
      { star: 5, percentage: 30 },
    ],
    groundingUrls: [{ title: 'Google Maps', uri: 'https://www.google.com/maps/place/?q=place_id:place-id' }],
    meta: {
      cached: false,
      model: 'google/gemini-3-flash-preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      budgetState: 'ok',
    },
  };
}
