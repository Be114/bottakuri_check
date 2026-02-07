import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const ADSENSE_CLIENT_ID = import.meta.env.VITE_ADSENSE_CLIENT_ID || '';
const ADSENSE_SLOT_ID = import.meta.env.VITE_ADSENSE_SLOT_ID || '';

let scriptPromise: Promise<void> | null = null;

function loadAdSenseScript(clientId: string): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-adsense-loader="true"]');
    if (existingScript) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    script.crossOrigin = 'anonymous';
    script.dataset.adsenseLoader = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('AdSense script failed to load'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

const AdBanner: React.FC = () => {
  const adRef = useRef<HTMLElement | null>(null);
  const hasAdConfig = Boolean(ADSENSE_CLIENT_ID && ADSENSE_SLOT_ID);

  useEffect(() => {
    if (!hasAdConfig || !adRef.current) return;

    let cancelled = false;

    loadAdSenseScript(ADSENSE_CLIENT_ID)
      .then(() => {
        if (cancelled) return;
        try {
          window.adsbygoogle = window.adsbygoogle || [];
          window.adsbygoogle.push({});
        } catch (error) {
          console.error('Failed to render AdSense slot', error);
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [hasAdConfig]);

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-semibold tracking-wide text-gray-500 bg-gray-100 px-2 py-1 rounded">
          広告
        </span>
        <p className="text-xs text-gray-500">広告は判定に影響しません</p>
      </div>

      {hasAdConfig ? (
        <ins
          ref={adRef}
          className="adsbygoogle block w-full min-h-[90px] rounded-md bg-gray-50"
          style={{ display: 'block' }}
          data-ad-client={ADSENSE_CLIENT_ID}
          data-ad-slot={ADSENSE_SLOT_ID}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : (
        <div className="w-full min-h-[90px] rounded-md bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center">
          <p className="text-xs text-gray-400">広告枠（AdSense設定後に表示）</p>
        </div>
      )}
    </section>
  );
};

export default AdBanner;
