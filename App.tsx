import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, MapPin, Search, ShieldAlert } from 'lucide-react';
import { ApiError, ApiErrorCode, SearchState } from './types';
import { analyzePlace } from './services/apiService';
import AnalysisDashboard from './components/AnalysisDashboard';

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  INVALID_QUERY: '店名や場所は2〜80文字で入力してください。',
  RATE_LIMIT: 'アクセスが集中しています。少し時間をおいて再度お試しください。',
  BUDGET_EXCEEDED: '本日の新規分析上限に達しました。明日以降に再度お試しください。',
  MODEL_UNAVAILABLE: '現在AI分析が混雑しています。時間をおいて再試行してください。',
  UPSTREAM_ERROR: '外部サービスへの接続に失敗しました。しばらくして再度お試しください。',
};

const FEATURES: { svg: ReactNode; title: string; desc: string }[] = [
  {
    svg: <AnimatedSearchSVG />,
    title: '多角的な評価分析',
    desc: 'Googleマップの評価だけでなく、他の信頼できるグルメサイトの情報と比較し、不自然な評価のズレがないかチェックします。',
  },
  {
    svg: <AnimatedAISVG />,
    title: 'AIによる詳細分析',
    desc: 'AIがクチコミの文章を詳しく読み込み、サクラ特有の言い回しや不自然な投稿パターン、危険なキーワードを検出します。',
  },
  {
    svg: <AnimatedGaugeSVG />,
    title: 'ひと目でわかる危険度',
    desc: 'お店の「サクラ危険度」を0%〜100%の数値で表示。グラフや詳細レポートで、なぜ危険なのかを分かりやすく解説します。',
  },
];

function getMessageFromError(error: unknown): { code?: ApiErrorCode; message: string } {
  if (error && typeof error === 'object' && 'code' in error) {
    const apiError = error as ApiError;
    const message = ERROR_MESSAGES[apiError.code] || apiError.message;
    return { code: apiError.code, message };
  }
  return { message: '分析中にエラーが発生しました。もう一度お試しください。' };
}

function AnimatedSearchSVG() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="searchGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect x="14" y="10" width="36" height="44" rx="4" stroke="#E2E8F0" strokeWidth="2" fill="white" />
      <line x1="22" y1="20" x2="42" y2="20" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="28" x2="36" y2="28" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="36" x2="42" y2="36" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      <motion.g
        animate={{ x: [0, 12, -6, 0], y: [0, 16, 8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <circle cx="26" cy="26" r="12" stroke="url(#searchGrad)" strokeWidth="3" fill="rgba(255,255,255,0.9)" />
        <line x1="34" y1="34" x2="44" y2="44" stroke="url(#searchGrad)" strokeWidth="3" strokeLinecap="round" />
        <motion.line
          x1="16"
          y1="20"
          x2="36"
          y2="20"
          stroke="#3B82F6"
          strokeWidth="1.5"
          opacity="0.6"
          animate={{ y: [0, 12, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        />
      </motion.g>
    </svg>
  );
}

function AnimatedAISVG() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="aiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <rect x="14" y="14" width="36" height="36" rx="8" stroke="url(#aiGrad)" strokeWidth="2" fill="white" />
      <motion.rect
        x="24"
        y="24"
        width="16"
        height="16"
        rx="4"
        fill="url(#aiGrad)"
        opacity="0.1"
        animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.3, 0.1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <rect x="26" y="26" width="12" height="12" rx="3" fill="url(#aiGrad)" />
      <motion.path
        d="M32 14 V6 M32 50 V58 M14 32 H6 M50 32 H58"
        stroke="url(#aiGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ opacity: 0.3 }}
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path
        d="M22 14 V8 M42 14 V8 M22 50 V56 M42 50 V56 M14 22 H8 M14 42 H8 M50 22 H56 M50 42 H56"
        stroke="#CBD5E1"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AnimatedGaugeSVG() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>
      </defs>
      <path d="M10 46 A 22 22 0 0 1 54 46" stroke="#E2E8F0" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M10 46 A 22 22 0 0 1 54 46" stroke="url(#gaugeGrad)" strokeWidth="6" strokeLinecap="round" fill="none" />
      <line x1="16" y1="36" x2="20" y2="38" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="24" x2="32" y2="28" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      <line x1="48" y1="36" x2="44" y2="38" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      <motion.line
        x1="32"
        y1="46"
        x2="32"
        y2="26"
        stroke="#334155"
        strokeWidth="3"
        strokeLinecap="round"
        style={{ originX: 0.5, originY: 1 }}
        animate={{ rotate: [-60, 50, -10, 70, 20] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <circle cx="32" cy="46" r="5" fill="#334155" />
      <circle cx="32" cy="46" r="2" fill="white" />
      <motion.circle
        cx="54"
        cy="20"
        r="4"
        fill="#EF4444"
        animate={{ scale: [1, 1.6, 1], opacity: [1, 0, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </svg>
  );
}

function CollectingDataSVG() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <motion.circle
        cx="60"
        cy="60"
        r="40"
        stroke="#E2E8F0"
        strokeWidth="2"
        strokeDasharray="4 4"
        animate={{ rotate: 360 }}
        transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '60px 60px' }}
      />
      <motion.circle
        cx="60"
        cy="60"
        r="25"
        stroke="#3B82F6"
        strokeWidth="3"
        strokeDasharray="40 40"
        animate={{ rotate: -360 }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '60px 60px' }}
      />
      <motion.path
        d="M60 45 L60 75 M45 60 L75 60"
        stroke="#8B5CF6"
        strokeWidth="3"
        strokeLinecap="round"
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '60px 60px' }}
      />
      {[0, 1, 2, 3].map((item) => (
        <motion.circle
          key={item}
          cx="60"
          cy="20"
          r="4"
          fill="#3B82F6"
          animate={{ rotate: [item * 90, item * 90 + 360], scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, delay: item * 0.5 }}
          style={{ transformOrigin: '60px 60px' }}
        />
      ))}
    </svg>
  );
}

function AnalyzingDataSVG() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="30" width="60" height="60" rx="12" stroke="#8B5CF6" strokeWidth="3" fill="none" />
      <motion.rect
        x="30"
        y="30"
        width="60"
        height="60"
        rx="12"
        stroke="#3B82F6"
        strokeWidth="3"
        fill="none"
        animate={{ scale: [1, 1.1, 1], opacity: [1, 0, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        style={{ transformOrigin: '60px 60px' }}
      />
      <motion.line
        x1="30"
        y1="30"
        x2="90"
        y2="30"
        stroke="#3B82F6"
        strokeWidth="2"
        animate={{ y: [0, 60, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
      />
      <motion.rect
        x="40"
        y="45"
        width="15"
        height="10"
        rx="2"
        fill="#E2E8F0"
        animate={{ fill: ['#E2E8F0', '#8B5CF6', '#E2E8F0'] }}
        transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
      />
      <motion.rect
        x="65"
        y="45"
        width="15"
        height="10"
        rx="2"
        fill="#E2E8F0"
        animate={{ fill: ['#E2E8F0', '#3B82F6', '#E2E8F0'] }}
        transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
      />
      <motion.rect
        x="40"
        y="65"
        width="25"
        height="10"
        rx="2"
        fill="#E2E8F0"
        animate={{ fill: ['#E2E8F0', '#10B981', '#E2E8F0'] }}
        transition={{ duration: 1.5, repeat: Infinity, delay: 1 }}
      />
    </svg>
  );
}

function App() {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({
    isLoading: false,
    step: 'idle',
    message: '',
  });
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        console.log('Location access denied or failed', error);
      },
    );
  }, []);

  const currentView = useMemo(() => {
    if (searchState.step === 'complete' && searchState.data) return 'result';
    if (searchState.isLoading) return 'loading';
    return 'home';
  }, [searchState]);

  const handleSearch = async (event?: FormEvent) => {
    event?.preventDefault();

    const trimmedQuery = query.trim();
    if (!trimmedQuery || searchState.isLoading) return;

    setSearchState({
      isLoading: true,
      step: 'searching',
      message: 'お店の情報を分析しています...',
    });

    try {
      const finalResult = await analyzePlace({
        query: trimmedQuery,
        location: userLocation,
      });

      setSearchState({
        isLoading: false,
        step: 'complete',
        message: '',
        data: finalResult,
      });
    } catch (error) {
      const errorState = getMessageFromError(error);
      setSearchState({
        isLoading: false,
        step: 'error',
        message: errorState.message,
        errorCode: errorState.code,
      });
    }
  };

  const resetSearch = () => {
    setSearchState({ isLoading: false, step: 'idle', message: '' });
    setQuery('');
  };

  const loadingCopy = 'Googleマップ情報の取得とAI分析を実行中です。完了までこのままお待ちください。';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-blue-200 flex flex-col">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            onClick={resetSearch}
            disabled={searchState.isLoading}
          >
            <ShieldAlert className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-lg tracking-tight">飲食店サクラチェッカー</span>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 w-full flex-1">
        <AnimatePresence mode="wait">
          {currentView === 'home' && (
            <motion.section
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="pt-12 pb-24"
            >
              <div className="text-center mb-12">
                <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-6">
                  飲食店サクラチェッカー
                </h1>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Googleマップのクチコミの信頼性をAIで分析。他のグルメサイトとの評価ズレや、サクラ投稿を調査して、失敗しないお店選びをサポートします。
                </p>
              </div>

              <form onSubmit={handleSearch} className="max-w-2xl mx-auto relative group mb-24">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-300" />
                <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 p-2 flex items-center">
                  <div className="pl-4 pr-2 text-slate-400">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="店舗検索入力"
                    placeholder="店名や場所を入力 (例: 新宿 居酒屋 〇〇)"
                    className="flex-1 bg-transparent border-none focus:ring-0 text-lg py-3 px-2 outline-none w-full"
                    disabled={searchState.isLoading}
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    disabled={searchState.isLoading || !query.trim()}
                  >
                    {searchState.isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Search className="w-5 h-5" />
                    )}
                    <span className="hidden sm:inline">分析する</span>
                  </button>
                </div>

                {searchState.step === 'error' && (
                  <div className="mt-4 text-red-600 font-medium bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                    {searchState.message}
                  </div>
                )}
              </form>

              <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {FEATURES.map((feature) => (
                  <div
                    key={feature.title}
                    className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 text-center"
                  >
                    <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-slate-100">
                      {feature.svg}
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-3">{feature.title}</h2>
                    <p className="text-slate-600 text-sm leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {currentView === 'loading' && (
            <motion.section
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-32 text-center"
            >
              <div className="mb-8">
                {searchState.step === 'analyzing' ? <AnalyzingDataSVG /> : <CollectingDataSVG />}
              </div>
              <h1 className="text-2xl font-bold text-slate-800 mb-2">{searchState.message}</h1>
              <p className="text-slate-500">{loadingCopy}</p>
            </motion.section>
          )}

          {currentView === 'result' && searchState.data && (
            <AnalysisDashboard key="result" data={searchState.data} onReset={resetSearch} />
          )}
        </AnimatePresence>
      </main>

      {currentView === 'home' && (
        <footer className="bg-slate-900 text-slate-400 py-12 text-center mt-auto">
          <div className="max-w-4xl mx-auto px-4">
            <div className="flex items-center justify-center gap-2 mb-6">
              <ShieldAlert className="w-5 h-5 text-slate-500" />
              <span className="font-bold text-lg text-slate-300">飲食店サクラチェッカー</span>
            </div>
            <p className="text-sm mb-8">
              ※このツールはAIによる推測に基づいています。結果は参考程度にとどめ、最終的な判断はご自身で行ってください。
            </p>
            <div className="text-xs text-slate-500">
              &copy; {new Date().getFullYear()} 飲食店サクラチェッカー All rights reserved.
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
