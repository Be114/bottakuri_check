import { motion } from 'motion/react';

interface ScoreGaugeProps {
  score: number;
  verdict: string;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function fallbackVerdict(score: number): string {
  if (score >= 70) return '危険';
  if (score >= 40) return '注意';
  return '安全';
}

function normalizeVerdict(verdict: string, score: number): string {
  const normalized = verdict.trim().toLowerCase();
  if (!normalized) return fallbackVerdict(score);
  if (['safe', 'low', '安全'].includes(normalized)) return '安全';
  if (['suspicious', 'medium', 'warning', '注意'].includes(normalized)) return '注意';
  if (['danger', 'high', '危険'].includes(normalized)) return '危険';
  return verdict;
}

const ScoreGauge = ({ score, verdict }: ScoreGaugeProps) => {
  const displayScore = clampScore(score);
  const label = normalizeVerdict(verdict, displayScore);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (displayScore / 100) * circumference;

  const colorClass =
    displayScore >= 70 ? 'text-red-600' : displayScore >= 40 ? 'text-amber-500' : 'text-emerald-500';
  const badgeClass =
    displayScore >= 70
      ? 'text-red-700 bg-red-50'
      : displayScore >= 40
        ? 'text-amber-700 bg-amber-50'
        : 'text-emerald-700 bg-emerald-50';

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center h-full">
      <h2 className="text-lg font-bold text-slate-800 mb-4">サクラ危険度</h2>
      <div className="relative w-48 h-48 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 140 140" aria-hidden="true">
          <circle cx="70" cy="70" r={radius} stroke="#E2E8F0" strokeWidth="12" fill="none" />
          <motion.circle
            cx="70"
            cy="70"
            r={radius}
            stroke="currentColor"
            strokeWidth="12"
            fill="none"
            strokeLinecap="round"
            className={colorClass}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center">
          <span className={`text-5xl font-bold ${colorClass}`}>{displayScore}%</span>
          <span className={`text-sm font-medium px-3 py-1 rounded-full mt-2 ${badgeClass}`}>{label}</span>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-4">数値が高いほど危険な可能性が高いです</p>
    </div>
  );
};

export default ScoreGauge;
