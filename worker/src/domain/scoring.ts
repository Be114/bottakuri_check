import { clampNumber } from '../utils/validation';

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

export function adjustRiskScoreByDiscrepancy(
  baseScore: number,
  googleRating: number,
  comparableRating: number,
  placeName: string
): number {
  const discrepancy = googleRating - comparableRating;
  if (discrepancy <= 0.4) return baseScore;

  let penalty = discrepancy <= 0.8
    ? (discrepancy - 0.4) * 35
    : 14 + (discrepancy - 0.8) * 50;

  if (looksLikeChainStore(placeName)) {
    penalty *= 0.6;
  }

  return clampNumber(Math.round(baseScore + penalty), 0, 100);
}

function looksLikeChainStore(placeName: string): boolean {
  const chainKeywords = [
    'サイゼリヤ',
    '松屋',
    'すき家',
    'マクドナルド',
    'スターバックス',
    '鳥貴族',
    '吉野家',
    'ガスト',
    'くら寿司',
    'スシロー',
    'はま寿司',
    '一蘭',
  ];

  return chainKeywords.some((keyword) => placeName.includes(keyword));
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

function lerp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax <= inMin) return outMin;
  const ratio = clampNumber((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * ratio;
}

export function inferScoreFromText(summary: string): number {
  const normalized = summary.toLowerCase();
  if (normalized.includes('ぼったくり') || normalized.includes('詐欺')) return 75;
  if (normalized.includes('注意') || normalized.includes('不自然')) return 50;
  return 30;
}
