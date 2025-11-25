import React from 'react';

interface ScoreGaugeProps {
  score: number;
  verdict: string;
}

const ScoreGauge: React.FC<ScoreGaugeProps> = ({ score, verdict }) => {
  // Color logic based on score (High score = Bad)
  let colorClass = "text-green-500";
  let strokeColor = "#22c55e";
  let text = "安全";

  if (score >= 40) {
    colorClass = "text-yellow-500";
    strokeColor = "#eab308";
    text = "注意";
  }
  if (score >= 70) {
    colorClass = "text-red-600";
    strokeColor = "#dc2626";
    text = "危険";
  }

  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-sm border border-gray-100">
      <h3 className="text-lg font-bold text-gray-700 mb-2">ぼったくり危険度</h3>
      <div className="relative w-40 h-40 flex items-center justify-center">
        <svg className="transform -rotate-90 w-full h-full" viewBox="0 0 120 120">
          {/* Background Circle */}
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="10"
          />
          {/* Progress Circle */}
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className={`text-4xl font-bold ${colorClass}`}>{score}%</span>
          <span className={`text-sm font-medium mt-1 px-2 py-0.5 rounded-full bg-gray-100 ${colorClass}`}>
            {verdict}
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-4 text-center">
        数値が高いほど危険な可能性が高いです
      </p>
    </div>
  );
};

export default ScoreGauge;