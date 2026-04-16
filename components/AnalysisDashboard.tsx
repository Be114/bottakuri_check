import { type FC } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin, Search, Store, TrendingDown } from 'lucide-react';
import { AnalysisReport, AnalysisRisk } from '../types';
import ScoreGauge from './ScoreGauge';
import ReviewChart from './ReviewChart';

interface AnalysisDashboardProps {
  data: AnalysisReport;
  onReset: () => void;
}

const RISK_STYLE: Record<AnalysisRisk['riskLevel'], { icon: string; badge: string; label: string; text: string }> = {
  low: {
    icon: 'bg-emerald-100 text-emerald-600',
    badge: 'bg-emerald-100 text-emerald-700',
    label: '安全',
    text: 'text-emerald-600',
  },
  medium: {
    icon: 'bg-amber-100 text-amber-600',
    badge: 'bg-amber-100 text-amber-700',
    label: '注意',
    text: 'text-amber-600',
  },
  high: {
    icon: 'bg-red-100 text-red-600',
    badge: 'bg-red-100 text-red-700',
    label: '危険',
    text: 'text-red-600',
  },
};

function formatRating(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return value.toFixed(1);
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP');
}

function RiskIcon({ riskLevel }: { riskLevel: AnalysisRisk['riskLevel'] }) {
  if (riskLevel === 'low') return <CheckCircle2 className="w-5 h-5" />;
  return <AlertTriangle className="w-5 h-5" />;
}

const AnalysisDashboard: FC<AnalysisDashboardProps> = ({ data, onReset }) => {
  const diff = data.googleRating - data.estimatedRealRating;
  const isSuspiciousDiff = diff > 0.8;
  const generatedAtText = formatGeneratedAt(data.meta.generatedAt);
  const sourceLinks = data.groundingUrls.filter((link) => link.uri);

  return (
    <motion.section
      key="result"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-blue-600 text-sm font-medium mb-1">
            <MapPin className="w-4 h-4 shrink-0" />
            <span>{data.address}</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900">{data.placeName}</h1>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
        >
          <Search className="w-4 h-4" />
          別の場所を検索
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <ScoreGauge score={data.sakuraScore} verdict={data.verdict} />

        <div className="md:col-span-2 flex flex-col gap-6">
          <div className="grid sm:grid-cols-2 gap-6 h-full">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -z-0" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl font-bold text-blue-600">G</span>
                  <span className="font-bold text-slate-700">Google評価</span>
                </div>
                <div className="text-5xl font-bold text-slate-900 mb-1">{formatRating(data.googleRating)}</div>
                <div className="text-sm text-slate-500">ユーザーレビュー</div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Store className="w-5 h-5 text-orange-500" />
                  <span className="font-bold text-slate-700">実力値（補正後）</span>
                </div>
              </div>
              <div className={`text-5xl font-bold mb-2 ${isSuspiciousDiff ? 'text-red-500' : 'text-slate-900'}`}>
                {formatRating(data.estimatedRealRating)}
              </div>
              {data.tabelogRating ? (
                <div className="text-sm font-medium text-orange-600 mb-4">
                  食べログ生値: {data.tabelogRating.toFixed(2)}（補正済み）
                </div>
              ) : (
                <div className="text-sm text-slate-500 mb-4">AIによる補正値</div>
              )}
              {isSuspiciousDiff && (
                <div className="absolute bottom-4 right-4 bg-red-100 text-red-700 px-3 py-1 rounded text-sm font-bold flex items-center gap-1">
                  <TrendingDown className="w-4 h-4" />
                  乖離大
                </div>
              )}
            </div>
          </div>

          <div
            className={`${isSuspiciousDiff ? 'bg-orange-50 border-orange-200 text-orange-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'} border rounded-xl p-4 flex items-start gap-3`}
          >
            {isSuspiciousDiff ? (
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <p className="text-sm leading-relaxed">
              {isSuspiciousDiff
                ? `Googleの評価(${formatRating(data.googleRating)})と補正後実力値(${formatRating(data.estimatedRealRating)})に大きな乖離があります。評価のかさ増しが行われている可能性があります。`
                : 'Googleの評価と実力値に大きな矛盾は見られません。比較的信頼できる評価分布です。'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-lg font-bold text-slate-800">判定詳細レポート</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {data.risks.length > 0 ? (
              data.risks.map((risk, index) => {
                const style = RISK_STYLE[risk.riskLevel] || RISK_STYLE.medium;
                return (
                  <div key={`${risk.category}-${index}`} className="p-5 flex gap-4">
                    <div className="shrink-0 mt-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${style.icon}`}>
                        <RiskIcon riskLevel={risk.riskLevel} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-slate-900">{risk.category}</h3>
                        <span className={`px-2 py-0.5 text-xs font-bold rounded ${style.badge}`}>{style.label}</span>
                      </div>
                      <p className="text-slate-600 text-sm leading-relaxed">{risk.description}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-5 flex gap-4">
                <div className="shrink-0 mt-1">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-bold text-slate-900">目立ったリスクなし</h3>
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded">安全</span>
                  </div>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    現時点で強いサクラ投稿の兆候は検出されませんでした。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <ReviewChart data={data.reviewDistribution} />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-bold tracking-wider">AI分析</span>
            <h2 className="text-lg font-bold text-slate-800">総評</h2>
          </div>
          <p className="text-slate-700 leading-relaxed whitespace-pre-line">{data.summary}</p>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4">検出された怪しいキーワード</h2>
            {data.suspiciousKeywordsFound.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.suspiciousKeywordsFound.map((word, index) => (
                  <span
                    key={`${word}-${index}`}
                    className="px-3 py-1 bg-red-50 text-red-700 text-xs rounded-full border border-red-100"
                  >
                    {word}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 italic text-sm">怪しいキーワードは検出されませんでした。</p>
            )}
          </div>

          {sourceLinks.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <h2 className="text-lg font-bold text-slate-800 mb-4">参照ソース</h2>
              <ul className="space-y-3">
                {sourceLinks.map((link, index) => (
                  <li key={`${link.uri}-${index}`}>
                    <a
                      href={link.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm flex items-start gap-2"
                    >
                      <ExternalLink className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="line-clamp-1">{link.title || link.uri}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-wrap items-center gap-4 text-sm text-slate-500 mt-8">
        <div>モデル: {data.meta.model}</div>
        <div className="hidden sm:block w-px h-4 bg-slate-300" />
        <div>生成時刻: {generatedAtText}</div>
        <div className="hidden sm:block w-px h-4 bg-slate-300" />
        <div className={data.meta.cached ? 'text-blue-600 font-medium' : 'text-slate-500'}>
          {data.meta.cached ? 'キャッシュ結果' : '新規分析'}
        </div>
      </div>
    </motion.section>
  );
};

export default AnalysisDashboard;
