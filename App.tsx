import React, { useState, useEffect } from 'react';
import { Search, MapPin, Loader2 } from 'lucide-react';
import { ApiError, ApiErrorCode, SearchState } from './types';
import { analyzePlace } from './services/apiService';
import AnalysisDashboard from './components/AnalysisDashboard';

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  INVALID_QUERY: '店名や場所は2〜80文字で入力してください。',
  RATE_LIMIT: 'アクセスが集中しています。少し時間をおいて再度お試しください。',
  BUDGET_EXCEEDED: '本日の新規分析上限に達しました。明日以降に再度お試しください。',
  MODEL_UNAVAILABLE: '現在AI分析が混雑しています。時間をおいて再試行してください。',
  UPSTREAM_ERROR: '外部サービスへの接続に失敗しました。しばらくして再度お試しください。'
};

function getMessageFromError(error: unknown): { code?: ApiErrorCode; message: string } {
  if (error && typeof error === 'object' && 'code' in error) {
    const apiError = error as ApiError;
    const message = ERROR_MESSAGES[apiError.code] || apiError.message;
    return { code: apiError.code, message };
  }
  return { message: '分析中にエラーが発生しました。もう一度お試しください。' };
}

function App() {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({
    isLoading: false,
    step: 'idle',
    message: ''
  });
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log("Location access denied or failed", error);
        }
      );
    }
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const trimmedQuery = query.trim();

    setSearchState({
      isLoading: true,
      step: 'searching',
      message: 'お店の情報を収集中...'
    });

    const progressTimer = window.setTimeout(() => {
      setSearchState(prev => {
        if (!prev.isLoading || prev.step !== 'searching') return prev;
        return {
          ...prev,
          step: 'analyzing',
          message: 'AIがクチコミを分析しています...'
        };
      });
    }, 900);

    try {
      const finalResult = await analyzePlace({
        query: trimmedQuery,
        location: userLocation
      });

      setSearchState({
        isLoading: false,
        step: 'complete',
        message: '',
        data: finalResult
      });

    } catch (error) {
      const errorState = getMessageFromError(error);
      setSearchState({
        isLoading: false,
        step: 'error',
        message: errorState.message,
        errorCode: errorState.code
      });
    } finally {
      window.clearTimeout(progressTimer);
    }
  };

  const resetSearch = () => {
    setSearchState({ isLoading: false, step: 'idle', message: '' });
    setQuery('');
  };

  if (searchState.step === 'complete' && searchState.data) {
    return <AnalysisDashboard data={searchState.data} onReset={resetSearch} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Hero Section */}
      <header className="bg-white border-b border-gray-200 pt-16 pb-24 px-4 text-center relative overflow-hidden">
        <div className="max-w-2xl mx-auto relative z-10">
          <h1 className="text-3xl md:text-4xl font-black text-gray-900 mb-4 tracking-tight">
            飲食店サクラチェッカー
          </h1>
          <p className="text-gray-600 mb-8">
            最新のAIを使って、Googleマップのクチコミの信頼性を分析。<br/>
            他のグルメサイトとの評価のズレや、怪しい投稿を自動検出して、失敗しないお店選びをサポートします。
          </p>

          <form onSubmit={handleSearch} className="relative max-w-lg mx-auto">
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="店名や場所を入力 (例: 新宿 居酒屋 〇〇)"
                className="w-full pl-12 pr-12 py-4 bg-white border-2 border-gray-200 rounded-full shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none text-lg"
                disabled={searchState.isLoading}
              />
              <button 
                type="submit" 
                className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-blue-600 text-white p-2.5 rounded-full hover:bg-blue-700 transition-colors disabled:bg-gray-300"
                disabled={searchState.isLoading || !query.trim()}
              >
                {searchState.isLoading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
              </button>
            </div>
          </form>

          {searchState.step === 'error' && (
            <div className="mt-4 text-red-500 font-medium bg-red-50 inline-block px-4 py-2 rounded-lg">
              {searchState.message}
            </div>
          )}

          {searchState.isLoading && (
            <div className="mt-8 flex flex-col items-center animate-fade-in">
              <div className="w-64 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className={`h-full bg-blue-500 transition-all duration-[3000ms] ease-out ${searchState.step === 'searching' ? 'w-1/3' : 'w-full'}`}
                ></div>
              </div>
              <p className="text-sm text-gray-500 mt-2 font-medium animate-pulse">
                {searchState.message}
              </p>
            </div>
          )}
        </div>

        {/* Decorative Background Elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-0 pointer-events-none opacity-30">
          <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-200 rounded-full blur-3xl"></div>
          <div className="absolute top-40 -right-20 w-72 h-72 bg-purple-200 rounded-full blur-3xl"></div>
        </div>
      </header>

      {/* Features Section */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 -mt-12 relative z-20">
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard 
               icon={<span className="text-2xl">🔍</span>}
               title="多角的な評価分析"
               desc="Googleマップの評価だけでなく、他の信頼できるグルメサイトの情報と比較し、不自然な評価のズレがないかチェックします。"
            />
            <FeatureCard 
               icon={<span className="text-2xl">🤖</span>}
               title="AIによる詳細分析"
               desc="AIがクチコミの文章を詳しく読み込み、サクラ特有の言い回しや不自然な投稿パターン、危険なキーワードを検出します。"
            />
            <FeatureCard 
               icon={<span className="text-2xl">📊</span>}
               title="ひと目でわかる危険度"
               desc="お店の「サクラ危険度」を0%〜100%の数値で表示。グラフや詳細レポートで、なぜ危険なのかを分かりやすく解説します。"
            />
         </div>

         <div className="mt-16 mb-12 text-center">
           <p className="text-xs text-gray-400">
             ※このツールはAIによる推測に基づいています。結果は参考程度にとどめ、最終的な判断はご自身で行ってください。
           </p>
         </div>
      </main>
    </div>
  );
}

const FeatureCard = ({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
    <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center mb-4">
      {icon}
    </div>
    <h3 className="text-lg font-bold text-gray-800 mb-2">{title}</h3>
    <p className="text-gray-600 text-sm leading-relaxed">{desc}</p>
  </div>
);

export default App;
