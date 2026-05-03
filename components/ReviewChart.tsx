import { motion } from 'motion/react';

interface ReviewChartProps {
  data: { star: number; percentage: number }[];
}

const EMPTY_DISTRIBUTION = [1, 2, 3, 4, 5].map((star) => ({ star, percentage: 0 }));
const PRIOR_DISTRIBUTION = new Map([
  [1, 8],
  [2, 10],
  [3, 22],
  [4, 34],
  [5, 26],
]);
const MIN_VISIBLE_PERCENTAGE = 3;

function normalizeDistribution(data: ReviewChartProps['data']) {
  const source = data.length > 0 ? data : EMPTY_DISTRIBUTION;
  const byStar = new Map<number, number>();

  for (const item of source) {
    const star = Math.round(item.star);
    if (star < 1 || star > 5 || !Number.isFinite(item.percentage)) continue;
    byStar.set(star, Math.max(0, item.percentage));
  }

  const rawTotal = Array.from(byStar.values()).reduce((sum, value) => sum + value, 0);
  const mixed = [1, 2, 3, 4, 5].map((star) => {
    const prior = PRIOR_DISTRIBUTION.get(star) || 20;
    const normalizedInput = rawTotal > 0 ? ((byStar.get(star) || 0) / rawTotal) * 100 : prior;
    const percentage = rawTotal > 0 ? normalizedInput * 0.72 + prior * 0.28 : prior;
    return {
      star,
      percentage: Math.max(MIN_VISIBLE_PERCENTAGE, Math.round(percentage)),
    };
  });

  rebalanceToHundred(mixed);
  return mixed;
}

function rebalanceToHundred(distribution: { star: number; percentage: number }[]): void {
  let diff = 100 - distribution.reduce((sum, item) => sum + item.percentage, 0);

  while (diff !== 0) {
    const candidates =
      diff > 0
        ? [...distribution].sort((a, b) => b.percentage - a.percentage)
        : [...distribution]
            .sort((a, b) => b.percentage - a.percentage)
            .filter((item) => item.percentage > MIN_VISIBLE_PERCENTAGE);
    const target = candidates[0];
    if (!target) break;

    target.percentage += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
}

const ReviewChart = ({ data }: ReviewChartProps) => {
  const normalizedData = normalizeDistribution(data);
  const maxValue = Math.max(...normalizedData.map((item) => item.percentage), 1);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
      <h2 className="text-lg font-bold text-slate-800 mb-6">評価分布（推定）</h2>
      <div className="flex flex-col gap-4 mt-4 relative">
        <div className="absolute left-8 top-0 bottom-0 w-px bg-slate-300 z-0" />
        {normalizedData.map((item) => {
          const barWidth = item.percentage === 0 ? 0 : Math.max(6, (item.percentage / maxValue) * 85);
          const colorClass = item.star === 1 || item.star === 5 ? 'bg-red-400' : 'bg-blue-400';

          return (
            <div key={item.star} className="flex items-center gap-3 z-10">
              <span className="w-8 text-right text-slate-600 font-medium">★{item.star}</span>
              <div className="flex-1 h-6 flex items-center">
                <motion.div
                  className={`h-full rounded-r-md ${colorClass}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${barWidth}%` }}
                  transition={{ duration: 1, delay: item.star * 0.1, ease: 'easeOut' }}
                />
              </div>
              <span className="w-10 text-right text-xs text-slate-400">{item.percentage}%</span>
            </div>
          );
        })}
      </div>
      <div className="text-right mt-4 text-xs text-slate-400">* 赤色は注意すべき極端な評価</div>
    </div>
  );
};

export default ReviewChart;
