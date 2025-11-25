import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface ReviewChartProps {
  data: { star: number; percentage: number }[];
}

const ReviewChart: React.FC<ReviewChartProps> = ({ data }) => {
  // Ensure data is sorted 5 to 1 for display if needed, but typically graphs go 1-5 or 5-1.
  // Let's display 5 stars on top if vertical, or left-to-right 1->5.
  // Standard breakdown is usually 5, 4, 3, 2, 1 top to bottom or left to right.
  // Let's sort 1 to 5 for standard X-Axis
  const sortedData = [...data].sort((a, b) => a.star - b.star);

  return (
    <div className="w-full h-64 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <h3 className="text-sm font-bold text-gray-700 mb-4">評価分布（推定）</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sortedData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="star" tickFormatter={(val) => `★${val}`} width={40} />
          <Tooltip 
            formatter={(value: number) => [`${value}%`, '割合']}
            contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
          />
          <Bar dataKey="percentage" barSize={20} radius={[0, 4, 4, 0]}>
            {sortedData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.star === 5 || entry.star === 1 ? '#f87171' : '#60a5fa'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="text-xs text-gray-400 text-right mt-1">* 赤色は注意すべき極端な評価</div>
    </div>
  );
};

export default ReviewChart;
