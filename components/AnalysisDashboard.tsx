import React from 'react';
import { AnalysisReport } from '../types';
import ScoreGauge from './ScoreGauge';
import ReviewChart from './ReviewChart';
import { AlertTriangle, CheckCircle, ExternalLink, MapPin, Store, TrendingDown, Search } from 'lucide-react';

interface AnalysisDashboardProps {
  data: AnalysisReport;
  onReset: () => void;
}

const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({ data, onReset }) => {
  const diff = data.googleRating - data.estimatedRealRating;
  const isSuspiciousDiff = diff > 0.8;
  const generatedAtText = new Date(data.meta.generatedAt).toLocaleString('ja-JP');

  return (
    <div className="max-w-5xl mx-auto p-4 pb-20 space-y-6 animate-fade-in">
      {/* Header Section */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-blue-600 font-medium text-sm mb-1">
            <MapPin size={16} />
            <span>{data.address}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{data.placeName}</h1>
        </div>
        <button 
          onClick={onReset}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Search size={16} />
          別の場所を検索
        </button>
      </div>

      {/* Top Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Score Gauge */}
        <div className="md:col-span-1">
          <ScoreGauge score={data.sakuraScore} verdict={data.verdict} />
        </div>

        {/* Rating Comparison */}
        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between relative overflow-hidden">
            <div className="z-10">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/120px-Google_%22G%22_logo.svg.png" alt="Google" className="w-5 h-5" />
                <span className="font-bold text-sm">Google評価</span>
              </div>
              <div className="text-4xl font-bold text-gray-800">{data.googleRating.toFixed(1)}</div>
              {data.reviewDistribution.length > 0 && (
                <div className="text-xs text-gray-400 mt-1">ユーザーレビュー</div>
              )}
            </div>
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-full -mr-4 -mt-4"></div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between relative overflow-hidden">
            <div className="z-10">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                <Store size={18} className="text-orange-500" />
                <span className="font-bold text-sm">実力値（補正後）</span>
              </div>
              <div className={`text-4xl font-bold ${isSuspiciousDiff ? 'text-red-500' : 'text-gray-800'}`}>
                {data.estimatedRealRating.toFixed(1)}
              </div>
              {data.tabelogRating ? (
                 <div className="text-xs text-orange-500 font-medium mt-1">
                   食べログ生値: {data.tabelogRating.toFixed(2)}（補正済み）
                 </div>
              ) : (
                 <div className="text-xs text-gray-400 mt-1">AIによる補正値</div>
              )}
            </div>
            {isSuspiciousDiff && (
              <div className="absolute bottom-4 right-4 bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">
                <TrendingDown size={14} />
                乖離大
              </div>
            )}
          </div>
          
          {/* Discrepancy Explanation */}
          <div className="sm:col-span-2 bg-orange-50 border border-orange-100 rounded-lg p-3 flex items-start gap-3">
             <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" size={18} />
             <p className="text-sm text-orange-800 leading-relaxed">
               {isSuspiciousDiff 
                 ? `Googleの評価(${data.googleRating})と補正後実力値(${data.estimatedRealRating.toFixed(1)})に大きな乖離があります。評価のかさ増しが行われている可能性があります。`
                 : `Googleの評価と実力値に大きな矛盾は見られません。比較的信頼できる評価分布です。`}
             </p>
          </div>
        </div>
      </div>

      {/* Main Analysis Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Risks & Keywords */}
        <div className="lg:col-span-2 space-y-6">
          {/* Risk Breakdown */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
              <h3 className="font-bold text-gray-800">判定詳細レポート</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {data.risks.map((risk, index) => (
                <div key={index} className="p-4 flex items-start gap-4">
                  <div className={`shrink-0 mt-1 w-8 h-8 rounded-full flex items-center justify-center ${
                    risk.riskLevel === 'high' ? 'bg-red-100 text-red-600' : 
                    risk.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'
                  }`}>
                    {risk.riskLevel === 'high' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-gray-800 text-sm">{risk.category}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        risk.riskLevel === 'high' ? 'bg-red-100 text-red-700' : 
                        risk.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {risk.riskLevel === 'high' ? '危険' : risk.riskLevel === 'medium' ? '注意' : '安全'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{risk.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
             <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
               <span className="bg-gradient-to-r from-blue-500 to-purple-500 text-white text-xs px-2 py-0.5 rounded">AI分析</span>
               総評
             </h3>
             <p className="text-sm text-gray-700 leading-7 whitespace-pre-line">
               {data.summary}
             </p>
          </div>
        </div>

        {/* Right Column: Charts & Keywords */}
        <div className="space-y-6">
          <ReviewChart data={data.reviewDistribution} />

          {/* Keywords Cloud */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-4">検出された怪しいキーワード</h3>
            {data.suspiciousKeywordsFound.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.suspiciousKeywordsFound.map((word, i) => (
                  <span key={i} className="px-3 py-1 bg-red-50 text-red-700 text-xs rounded-full border border-red-100">
                    {word}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">怪しいキーワードは検出されませんでした。</p>
            )}
          </div>

          {/* Grounding Links */}
          {data.groundingUrls.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-3">参照ソース</h3>
              <ul className="space-y-2">
                {data.groundingUrls.map((link, i) => (
                  <li key={i}>
                    <a 
                      href={link.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline flex items-start gap-1.5"
                    >
                      <ExternalLink size={12} className="mt-0.5 shrink-0" />
                      <span className="line-clamp-1">{link.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span>モデル: {data.meta.model}</span>
        <span className="text-gray-300">|</span>
        <span>生成時刻: {generatedAtText}</span>
        <span className="text-gray-300">|</span>
        <span className={data.meta.cached ? 'text-blue-600 font-medium' : 'text-gray-600'}>
          {data.meta.cached ? 'キャッシュ結果' : '新規分析'}
        </span>
      </div>
    </div>
  );
};

export default AnalysisDashboard;
