import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AnalysisDashboard from '../components/AnalysisDashboard';
import NearbyRankingDashboard from '../components/NearbyRankingDashboard';
import ReviewChart from '../components/ReviewChart';
import ScoreGauge from '../components/ScoreGauge';
import { analyzePlace } from '../services/apiService';
import { AnalysisReport, NearbyRankingReport } from '../types';

vi.mock('../services/apiService', () => ({
  API_BASE_URL: 'https://bottakuri-check-api.steep-wood-db4a.workers.dev/api',
  analyzePlace: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

    const addressLink = screen.getByRole('link', { name: /東京都新宿区/ });
    expect(addressLink).toHaveAttribute('href', expect.stringContaining('https://www.google.com/maps/search/?api=1'));

    const sourceLink = screen.getByRole('link', { name: /Google Maps/ });
    expect(sourceLink).toHaveAttribute('href', 'https://www.google.com/maps/place/?q=place_id:place-id');
    expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(screen.getByRole('button', { name: /別の場所を検索/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('can hide the reset action for embedded individual analysis', () => {
    render(<AnalysisDashboard data={buildReport()} onReset={vi.fn()} showNearbyCta={false} showResetAction={false} />);

    expect(screen.queryByRole('button', { name: /別の場所を検索/ })).not.toBeInTheDocument();
  });

  it('renders the nearby CTA when a handler is provided', () => {
    const onFindNearby = vi.fn();
    render(<AnalysisDashboard data={buildReport()} onReset={vi.fn()} onFindNearby={onFindNearby} />);

    fireEvent.click(screen.getByRole('button', { name: /近くの優良店を探す/ }));
    expect(onFindNearby).toHaveBeenCalledTimes(1);
  });
});

describe('NearbyRankingDashboard', () => {
  function getAnalysisButton(placeName: string): HTMLElement {
    return screen.getByRole('button', { name: `${placeName}の分析詳細を見る` });
  }

  it('renders ranking, compact origin metadata, and back action', () => {
    const onBack = vi.fn();
    render(<NearbyRankingDashboard report={buildNearbyReport()} analyzedReport={buildReport()} onBack={onBack} />);

    expect(screen.getByText('周辺の優良店ランキング')).toBeInTheDocument();
    expect(screen.getAllByText('価格帯').length).toBeGreaterThan(0);
    expect(screen.getAllByText('¥¥').length).toBeGreaterThan(0);
    expect(screen.getByText('周辺の優良店ランキング').closest('span')).toHaveClass('whitespace-nowrap');
    expect(screen.getByText('元店舗')).toBeInTheDocument();
    expect(screen.getAllByText('優良店A').length).toBeGreaterThan(0);
    expect(screen.getByText('TOP10')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'PCランキングの並び順' })).toHaveValue('rank');
    expect(screen.getByRole('combobox', { name: 'ランキングの並び順' })).toHaveValue('rank');
    expect(screen.getAllByText(/サクラ疑い\s+低/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('低').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('低').length).toBeGreaterThan(0);
    expect(screen.queryByText('分析日時')).not.toBeInTheDocument();
    expect(screen.queryByText('全店舗クリックで個別分析')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /元の1店舗分析へ戻る/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('hides radius expansion notices but keeps other warnings visible', () => {
    const report = buildNearbyReport();
    report.meta.warnings = ['候補を10件集めるため、半径を1200mまで拡大しました。', '一部店舗の分析に失敗しました。'];

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    expect(screen.queryByText(/半径を1200mまで拡大/)).not.toBeInTheDocument();
    expect(screen.getByText('一部店舗の分析に失敗しました。')).toBeInTheDocument();
  });

  it('positions top pins from coordinates relative to the origin', () => {
    const report = buildNearbyReport();
    report.origin.location = { lat: 0, lng: 0 };
    report.places[0].location = { lat: 0, lng: 0.01 };
    report.places[1].location = { lat: 0.01, lng: 0 };
    report.places[2].location = { lat: -0.01, lng: -0.01 };

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    expect(screen.getByTestId('nearby-map-pin-1')).toHaveStyle({ left: '82%', top: '50%' });
    expect(screen.getByTestId('nearby-map-pin-2')).toHaveStyle({ left: '50%', top: '18%' });
    expect(screen.getByTestId('nearby-map-pin-3')).toHaveStyle({ left: '18%', top: '82%' });
  });

  it('renders the worker-proxied static map image and keeps map buttons available', () => {
    const report = buildNearbyReport();
    report.mapImageUrl = '/api/nearby-map?origin=35.6895,139.6917&pins=candidate-1';
    report.mapEmbedUrl = 'https://www.google.com/maps?q=%E5%85%83%E5%BA%97%E8%88%97&output=embed';

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    const mapImage = screen.getByRole('img', { name: '上位3店舗と起点を示す周辺マップ' });
    expect(mapImage).toHaveAttribute(
      'src',
      'https://bottakuri-check-api.steep-wood-db4a.workers.dev/api/nearby-map?origin=35.6895,139.6917&pins=candidate-1',
    );
    expect(mapImage).not.toHaveAttribute('src', '/api/nearby-map?origin=35.6895,139.6917&pins=candidate-1');
    expect(screen.getByRole('button', { name: '優良店Aの地図を開く' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1位' })).toBeInTheDocument();
    expect(screen.queryByTitle('上位3店舗と起点を示す周辺マップ')).not.toBeInTheDocument();
  });

  it('builds a worker-proxied static map image from coordinates when the API omits mapImageUrl', () => {
    const report = buildNearbyReport();
    report.mapImageUrl = undefined;
    report.mapEmbedUrl = undefined;

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    expect(screen.getByRole('img', { name: '上位3店舗と起点を示す周辺マップ' })).toHaveAttribute(
      'src',
      expect.stringContaining(
        'https://bottakuri-check-api.steep-wood-db4a.workers.dev/api/nearby-map?originLat=35.689500&originLng=139.691700',
      ),
    );
  });

  it('falls back to a safe Google Maps iframe when the static image fails', () => {
    const report = buildNearbyReport();
    report.mapImageUrl = '/api/nearby-map?origin=35.6895,139.6917&pins=candidate-1';
    report.mapEmbedUrl = 'https://www.google.com/maps?q=%E5%85%83%E5%BA%97%E8%88%97&output=embed';

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.error(screen.getByRole('img', { name: '上位3店舗と起点を示す周辺マップ' }));

    expect(screen.getByTitle('上位3店舗と起点を示す周辺マップ')).toHaveAttribute(
      'src',
      'https://www.google.com/maps?q=%E5%85%83%E5%BA%97%E8%88%97&output=embed',
    );
    expect(screen.getByRole('button', { name: '1位' })).toBeInTheDocument();
  });

  it('renders a safe Google Maps iframe when there is no static image URL', () => {
    const report = buildNearbyReport();
    report.places.forEach((place) => {
      place.location = undefined;
    });
    report.mapEmbedUrl = 'https://www.google.com/maps?q=%E5%85%83%E5%BA%97%E8%88%97&output=embed';

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    expect(screen.queryByRole('img', { name: '上位3店舗と起点を示す周辺マップ' })).not.toBeInTheDocument();
    expect(screen.getByTitle('上位3店舗と起点を示す周辺マップ')).toHaveAttribute(
      'src',
      'https://www.google.com/maps?q=%E5%85%83%E5%BA%97%E8%88%97&output=embed',
    );
  });

  it('uses the interactive Google map on mobile when an embed URL is available', () => {
    const report = buildNearbyReport();
    report.mapEmbedUrl = 'https://www.google.com/maps?q=%E5%85%83%E5%BA%97%E8%88%97&output=embed';

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    expect(screen.getByTitle('モバイル周辺マップ')).toHaveAttribute(
      'src',
      'https://www.google.com/maps?q=%E5%85%83%E5%BA%97%E8%88%97&output=embed',
    );
    expect(screen.queryByRole('img', { name: 'モバイル周辺マップ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '優良店Aの地図を開く（モバイル）' })).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-ranking-sheet-handle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ランキングを畳む' })).not.toBeInTheDocument();
  });

  it('keeps mobile static map fallback proportional when no embed URL is available', () => {
    const report = buildNearbyReport();
    report.mapEmbedUrl = undefined;

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    expect(screen.getByRole('img', { name: 'モバイル周辺マップ' })).toHaveClass('object-contain');
  });

  it('collapses the mobile ranking sheet with a downward swipe gesture', () => {
    render(<NearbyRankingDashboard report={buildNearbyReport()} analyzedReport={buildReport()} onBack={vi.fn()} />);

    const handle = screen.getByTestId('mobile-ranking-sheet-handle');
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 180, pointerId: 1 });

    expect(screen.queryByRole('button', { name: '優良店Aの分析詳細を見る' })).not.toBeInTheDocument();
  });

  it('does not render unsafe Google Maps iframe URLs', () => {
    const report = buildNearbyReport();
    report.mapEmbedUrl = 'https://maps.googleapis.com/maps/api/staticmap?center=tokyo&output=embed&key=browser-key';

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    expect(screen.queryByTitle('上位3店舗と起点を示す周辺マップ')).not.toBeInTheDocument();
  });

  it('does not render direct Google Static Map URLs as images', () => {
    const report = buildNearbyReport();
    report.mapImageUrl = 'https://maps.googleapis.com/maps/api/staticmap?center=tokyo&key=browser-key';

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    const mapImage = screen.getByRole('img', { name: '上位3店舗と起点を示す周辺マップ' });
    expect(mapImage).not.toHaveAttribute('src', report.mapImageUrl);
    expect(mapImage).toHaveAttribute(
      'src',
      expect.stringContaining('https://bottakuri-check-api.steep-wood-db4a.workers.dev/api/nearby-map'),
    );
  });

  it('rejects worker map images from untrusted hosts', () => {
    const report = buildNearbyReport();
    report.mapImageUrl = 'https://attacker.workers.dev/api/nearby-map?origin=35.6895,139.6917&pins=candidate-1';
    report.mapEmbedUrl = undefined;

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    const mapImage = screen.getByRole('img', { name: '上位3店舗と起点を示す周辺マップ' });
    expect(mapImage).not.toHaveAttribute('src', report.mapImageUrl);
    expect(mapImage).toHaveAttribute(
      'src',
      expect.stringContaining('https://bottakuri-check-api.steep-wood-db4a.workers.dev/api/nearby-map'),
    );
  });

  it('uses the sorted top three places for generated map pins', () => {
    const report = buildNearbyReport();
    report.mapImageUrl = undefined;
    report.mapEmbedUrl = undefined;
    report.places[4].distanceMeters = 10;
    report.places[4].location = { lat: 35.71, lng: 139.72 };

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'PCランキングの並び順' }), {
      target: { value: 'distance' },
    });

    expect(screen.getByTestId('nearby-map-pin-5')).toBeInTheDocument();
    const mapImage = screen.getByRole('img', { name: '上位3店舗と起点を示す周辺マップ' });
    expect(decodeURIComponent(mapImage.getAttribute('src') || '')).toContain('pins=5,35.710000,139.720000');
  });

  it('opens a Google Maps URL from pins and map buttons without triggering candidate analysis', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const report = buildNearbyReport();
    report.places[0].mapUrl = 'https://www.google.com/url?q=https%3A%2F%2Fexample.test';
    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '優良店Aの地図を開く' }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://www.google.com/maps/search/?api=1'),
      '_blank',
      'noopener,noreferrer',
    );
    expect(openSpy.mock.calls[0][0]).toContain('query_place_id=candidate-1');
    expect(openSpy.mock.calls[0][0]).not.toContain('google.com/url');

    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(analyzePlace).not.toHaveBeenCalled();
  });

  it('reuses an included analysis report for top candidates without calling analyze again', async () => {
    const report = buildNearbyReport();
    report.places[0].analysisReport = {
      ...buildReport(),
      placeName: '優良店A 詳細分析',
      address: '東京都新宿区 詳細住所',
    };

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(getAnalysisButton('優良店A'));

    expect(await screen.findByText('優良店A 詳細分析')).toBeInTheDocument();
    expect(analyzePlace).not.toHaveBeenCalled();
  });

  it('scrolls to the selected-place analysis section when details are requested', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const report = buildNearbyReport();
    report.places[0].analysisReport = {
      ...buildReport(),
      placeName: '優良店A 詳細分析',
    };

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(getAnalysisButton('優良店A'));

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });
  });

  it('does not scroll or analyze when a desktop ranking row is only selected', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(<NearbyRankingDashboard report={buildNearbyReport()} analyzedReport={buildReport()} onBack={vi.fn()} />);

    const desktopRow = screen.getAllByText('優良店4')[0].closest('tr');
    expect(desktopRow).not.toBeNull();
    fireEvent.click(desktopRow as HTMLTableRowElement);

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(analyzePlace).not.toHaveBeenCalled();
  });

  it('uses name plus address and candidate location when requesting top candidate analysis', async () => {
    vi.mocked(analyzePlace).mockResolvedValue({
      ...buildReport(),
      placeName: '優良店A 再分析',
    });

    render(<NearbyRankingDashboard report={buildNearbyReport()} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(getAnalysisButton('優良店A'));

    await waitFor(() => {
      expect(analyzePlace).toHaveBeenCalledWith({
        query: '優良店A 東京都新宿区',
        location: { lat: 35.68, lng: 139.69 },
      });
    });
    expect(await screen.findByText('優良店A 再分析')).toBeInTheDocument();
  });

  it('allows non-top candidates to request individual analysis', async () => {
    vi.mocked(analyzePlace).mockResolvedValue({
      ...buildReport(),
      placeName: '優良店4 再分析',
    });

    render(<NearbyRankingDashboard report={buildNearbyReport()} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(getAnalysisButton('優良店4'));

    await waitFor(() => {
      expect(analyzePlace).toHaveBeenCalledWith({
        query: '優良店4 東京都新宿区',
        location: {
          lat: expect.closeTo(35.683),
          lng: expect.closeTo(139.693),
        },
      });
    });
    expect(await screen.findByText('優良店4 再分析')).toBeInTheDocument();
  });

  it('does not fall back to the origin location when the selected candidate has no location', async () => {
    const report = buildNearbyReport();
    report.places[0].location = undefined;
    vi.mocked(analyzePlace).mockResolvedValue({
      ...buildReport(),
      placeName: '優良店A 住所再分析',
    });

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(getAnalysisButton('優良店A'));

    await waitFor(() => {
      expect(analyzePlace).toHaveBeenCalledWith({
        query: '優良店A 東京都新宿区',
        location: undefined,
      });
    });
    expect(await screen.findByText('優良店A 住所再分析')).toBeInTheDocument();
  });

  it('shows a retry action when top candidate analysis fails', async () => {
    vi.mocked(analyzePlace)
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({
        ...buildReport(),
        placeName: '優良店A 再試行後',
      });

    render(<NearbyRankingDashboard report={buildNearbyReport()} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(getAnalysisButton('優良店A'));
    fireEvent.click(await screen.findByRole('button', { name: '再試行' }));

    expect(await screen.findByText('優良店A 再試行後')).toBeInTheDocument();
    expect(analyzePlace).toHaveBeenCalledTimes(2);
  });

  it('prefers valid Google mapUrl values from the API', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const report = buildNearbyReport();
    report.places[0].mapUrl = 'https://www.google.com/maps/place/?q=place_id:worker-place-id';

    render(<NearbyRankingDashboard report={report} analyzedReport={buildReport()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '優良店Aの地図を開く' }));
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.google.com/maps/place/?q=place_id:worker-place-id',
      '_blank',
      'noopener,noreferrer',
    );
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
      model: 'google/gemini-3.1-flash-lite-preview',
      generatedAt: '2026-01-01T00:00:00.000Z',
      budgetState: 'ok',
    },
  };
}

function buildNearbyReport(): NearbyRankingReport {
  return {
    origin: {
      type: 'analyzed_place',
      location: { lat: 35.6895, lng: 139.6917 },
      placeName: '元店舗',
      address: '東京都新宿区',
    },
    places: Array.from({ length: 5 }, (_, index) => ({
      id: `candidate-${index + 1}`,
      placeId: `candidate-${index + 1}`,
      rank: index + 1,
      name: index === 0 ? '優良店A' : `優良店${index + 1}`,
      genre: '居酒屋',
      placeName: index === 0 ? '優良店A' : `優良店${index + 1}`,
      address: '東京都新宿区',
      location: { lat: 35.68 + index * 0.001, lng: 139.69 + index * 0.001 },
      mapUrl: 'https://maps.example.com',
      googleRating: 4.3,
      estimatedRealRating: 4.1,
      priceLevel: index % 3 === 0 ? 2 : 1,
      userRatingCount: 120,
      trustScore: 90 - index * 4,
      sakuraScore: 15,
      suspicionLevel: 'サクラ疑い 低' as 'low',
      verdict: '安全',
      reviewCount: 120,
      distanceMeters: 180,
      categories: ['居酒屋'],
      summary: '安定した評価の候補です。',
      reasons: ['評価件数が十分'],
    })),
    meta: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      originType: 'analyzed_place',
      originPlaceName: '元店舗',
      originAddress: '東京都新宿区',
    },
  };
}
