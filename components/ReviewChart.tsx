import { motion } from 'motion/react';

interface ReviewChartProps {
  data: { star: number; percentage: number }[];
}

const EMPTY_DISTRIBUTION = [1, 2, 3, 4, 5].map((star) => ({ star, percentage: 0 }));

function normalizeDistribution(data: ReviewChartProps['data']) {
  const source = data.length > 0 ? data : EMPTY_DISTRIBUTION;
  return [...source]
    .filter((item) => Number.isFinite(item.star) && Number.isFinite(item.percentage))
    .sort((a, b) => a.star - b.star)
    .map((item) => ({
      star: item.star,
      percentage: Math.min(100, Math.max(0, Math.round(item.percentage))),
    }));
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
