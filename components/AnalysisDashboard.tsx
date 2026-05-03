import { type FC } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin, Search, Store, TrendingDown, Zap } from 'lucide-react';
import { AnalysisReport, AnalysisRisk } from '../types';
import ScoreGauge from './ScoreGauge';
import ReviewChart from './ReviewChart';

interface AnalysisDashboardProps {
  data: AnalysisReport;
  onReset: () => void;
  onFindNearby?: () => void;
  showNearbyCta?: boolean;
  showResetAction?: boolean;
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

function buildGoogleMapsUrl(data: AnalysisReport): string {
  if (data.location) {
    return `https://www.google.com/maps/search/?api=1&query=${data.location.lat},${data.location.lng}`;
  }

  const query = [data.placeName, data.address].filter(Boolean).join(' ').trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function RiskIcon({ riskLevel }: { riskLevel: AnalysisRisk['riskLevel'] }) {
  if (riskLevel === 'low') return <CheckCircle2 className="w-5 h-5" />;
  return <AlertTriangle className="w-5 h-5" />;
}

function buildDisplayRisks(data: AnalysisReport, isSuspiciousDiff: boolean): AnalysisRisk[] {
  const risks = data.risks.map(toDisplayRisk).map((risk, index) => ({
    ...risk,
    category: normalizePointTitle(risk.category, index),
  }));
  const result: AnalysisRisk[] = [];

  for (const risk of risks) {
    if (result.some((item) => item.category === risk.category)) continue;
    result.push(risk);
    if (result.length >= 2) break;
  }

  const fallbackRisks = buildFallbackRisks(data, isSuspiciousDiff);
  for (const risk of fallbackRisks) {
    if (result.length >= 2) break;
    if (result.some((item) => item.category === risk.category)) continue;
    result.push(risk);
  }

  return result.slice(0, 2);
}

function toDisplayRisk(risk: AnalysisRisk): AnalysisRisk {
  return {
    ...risk,
    category: formatRiskCategory(risk.category),
    description: softenRiskDescription(risk.category, risk.description),
  };
}

function formatRiskCategory(category: string): string {
  const normalized = category.trim().toLowerCase();
  const labels: Record<string, string> = {
    service_quality: '接客について',
    service: '接客について',
    pricing: '料金について',
    price: '料金について',
    billing: '会計について',
    billing_trouble: '会計について',
    price_opacity: '料金のわかりやすさ',
    catch_sales: '客引き・案内について',
    fake_praise: '口コミの雰囲気',
    review_distribution: '口コミの偏り',
    rating_gap: '評価の差',
    external_reputation: '外部サイトの評判',
    low_information: '情報の少なさ',
    review_text: '口コミ本文',
    star_pattern: '口コミの偏り',
    exception_policy: 'お店のタイプ',
    例外補正: 'お店のタイプも踏まえました',
    簡易評価: 'ざっくり確認',
    総合: 'レビュー内容',
    総合評価: 'レビュー内容',
    レビュー本文: '口コミ本文',
    評価乖離: '評価の差',
    評価分布: '口コミの偏り',
    外部評判: '外部サイトの評判',
  };

  if (labels[category]) return labels[category];
  if (labels[normalized]) return labels[normalized];

  const humanized = category
    .replace(/[_-]+/g, ' ')
    .replace(/\brisk\b/gi, '')
    .replace(/\bquality\b/gi, '品質')
    .trim();
  return humanized || '気になった点';
}

function normalizePointTitle(title: string, index: number): string {
  const trimmed = title.trim();
  if (
    !trimmed ||
    trimmed === 'なし' ||
    trimmed === '不明' ||
    trimmed === '気になった点' ||
    trimmed === '全体として' ||
    trimmed === '総合'
  ) {
    return index === 0 ? 'レビュー内容' : '評価の偏り';
  }
  if (trimmed === '口コミ本文') return 'レビュー内容';
  if (trimmed === '口コミの偏り') return '評価の偏り';
  if (trimmed === '評価の差') return '評価の偏り';
  return trimmed;
}

function buildFallbackRisks(data: AnalysisReport, isSuspiciousDiff: boolean): AnalysisRisk[] {
  const scoreRiskLevel: AnalysisRisk['riskLevel'] =
    data.sakuraScore >= 70 ? 'high' : data.sakuraScore >= 40 ? 'medium' : 'low';

  return [
    {
      category: 'レビュー内容',
      riskLevel: scoreRiskLevel,
      description:
        scoreRiskLevel === 'high'
          ? '口コミ本文に、料金や案内について注意したい内容が見られます。'
          : scoreRiskLevel === 'medium'
            ? '口コミ本文に少し気になる点があります。利用前に最近の口コミも見ておくと安心です。'
            : '口コミ本文を見る限り、会計トラブルや強引な案内を強く疑う内容は多くありません。',
    },
    {
      category: '評価の偏り',
      riskLevel: isSuspiciousDiff ? 'medium' : scoreRiskLevel === 'high' ? 'medium' : 'low',
      description: isSuspiciousDiff
        ? 'Google評価と補正後の評価に差があります。評価だけで決めず、口コミ本文も合わせて見ています。'
        : '星の付き方に極端な違和感は強く出ていません。評価分布は推定なので、参考情報として見てください。',
    },
  ];
}

function softenRiskDescription(category: string, description: string): string {
  const text = description.trim();
  if (!text) return 'この点について、念のため確認しておくと安心です。';

  if (category === '例外補正' || text.includes('false positive') || text.includes('通常慣行')) {
    if (text.includes('バー') || text.includes('居酒屋') || text.includes('お通し') || text.includes('チャージ')) {
      return 'バーや居酒屋では、お通しやチャージが普通にあるお店もあります。料金トラブルの話が一緒に出ていない限り、これだけで危ないとは見ません。';
    }
    if (text.includes('全国チェーン')) {
      return 'チェーン店は口コミの付き方に偏りが出やすいので、評価の差だけで強く疑わないようにしています。';
    }
    if (text.includes('レビュー件数が少ない')) {
      return '口コミがまだ少ないお店なので、星の偏りだけでは強く判断しないようにしています。';
    }
    if (text.includes('高級店') || text.includes('コース')) {
      return '価格が高いこと自体は問題にせず、料金説明や会計の食い違いがあるかを見ています。';
    }
    return 'お店の種類によって口コミの付き方が変わるため、その点を割り引いて見ています。';
  }

  if (
    text.includes('スタッフの接客態度にムラがある') ||
    text.includes('組織的な問題というよりは個別のオペレーション上の課題')
  ) {
    return '接客にばらつきがあるという声があります。ただ、ぼったくりやサクラを強く疑う内容ではなさそうです。';
  }

  return text
    .replace(/高リスク/g, '強く注意が必要')
    .replace(/リスク/g, '注意点')
    .replace(/シグナル/g, '気になる材料')
    .replace(/補正/g, '考慮')
    .replace(/乖離/g, '差')
    .replace(/検出されませんでした/g, '見つかりませんでした')
    .replace(/推奨します/g, 'おすすめします');
}

const AnalysisDashboard: FC<AnalysisDashboardProps> = ({
  data,
  onReset,
  onFindNearby,
  showNearbyCta = true,
  showResetAction = true,
}) => {
  const diff = data.googleRating - data.estimatedRealRating;
  const isSuspiciousDiff = diff > 0.8;
  const generatedAtText = formatGeneratedAt(data.meta.generatedAt);
  const sourceLinks = data.groundingUrls.filter((link) => link.uri);
  const mapUrl = buildGoogleMapsUrl(data);
  const displayRisks = buildDisplayRisks(data, isSuspiciousDiff);

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
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
          >
            <MapPin className="w-4 h-4 shrink-0" />
            <span>{data.address}</span>
          </a>
          <h1 className="text-3xl font-bold text-slate-900">{data.placeName}</h1>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          {showNearbyCta && onFindNearby && (
            <motion.button
              type="button"
              onClick={onFindNearby}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="group flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-5 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 hover:shadow-xl transition-all"
            >
              <Zap className="w-5 h-5 fill-current group-hover:animate-pulse" />
              近くの優良店を探す
            </motion.button>
          )}
          {showResetAction && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-medium transition-colors"
            >
              <Search className="w-4 h-4" />
              別の場所を検索
            </button>
          )}
        </div>
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
            <h2 className="text-lg font-bold text-slate-800">チェックしたポイント</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {displayRisks.map((risk, index) => {
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
            })}
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
