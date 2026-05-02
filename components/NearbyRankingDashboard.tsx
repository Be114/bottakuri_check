import { type FC, type MouseEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ExternalLink,
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  Star,
} from 'lucide-react';
import { API_BASE_URL, analyzePlace } from '../services/apiService';
import { AnalysisReport, NearbyPlace, NearbyRankingReport } from '../types';
import AnalysisDashboard from './AnalysisDashboard';

interface PinPosition {
  x: number;
  y: number;
}

interface GoogleMapInstance {
  fitBounds(bounds: GoogleLatLngBounds, padding?: number): void;
  getZoom(): number | undefined;
  setZoom(zoom: number): void;
}

interface GoogleLatLngBounds {
  extend(location: { lat: number; lng: number }): void;
}

interface GoogleMarkerInstance {
  map: GoogleMapInstance | null;
}

interface GoogleMapsNamespace {
  Map: new (element: HTMLElement, options: GoogleMapOptions) => GoogleMapInstance;
  LatLngBounds: new () => GoogleLatLngBounds;
  Marker?: new (options: GoogleLegacyMarkerOptions) => GoogleMarkerInstance;
  Point?: new (x: number, y: number) => unknown;
  Size?: new (width: number, height: number) => unknown;
  marker?: {
    AdvancedMarkerElement?: new (options: GoogleAdvancedMarkerOptions) => GoogleMarkerInstance;
  };
}

interface GoogleMapOptions {
  center: { lat: number; lng: number };
  zoom: number;
  mapId?: string;
  gestureHandling?: 'auto' | 'cooperative' | 'greedy' | 'none';
  clickableIcons?: boolean;
  disableDefaultUI?: boolean;
  fullscreenControl?: boolean;
  mapTypeControl?: boolean;
  streetViewControl?: boolean;
  zoomControl?: boolean;
}

interface GoogleAdvancedMarkerOptions {
  map: GoogleMapInstance;
  position: { lat: number; lng: number };
  title?: string;
  content?: HTMLElement;
  zIndex?: number;
}

interface GoogleLegacyMarkerOptions {
  map: GoogleMapInstance;
  position: { lat: number; lng: number };
  title?: string;
  icon?: GoogleLegacyMarkerIcon;
  label?: {
    text: string;
    color: string;
    fontWeight: string;
  };
  zIndex?: number;
}

interface GoogleLegacyMarkerIcon {
  url: string;
  anchor?: unknown;
  scaledSize?: unknown;
}

declare global {
  interface Window {
    google?: {
      maps?: GoogleMapsNamespace;
    };
    __initBottakuriGoogleMaps?: () => void;
    gm_authFailure?: () => void;
  }
}

type SortOption = 'rank' | 'trust' | 'distance' | 'price';

const SORT_LABELS: Record<SortOption, string> = {
  rank: 'ランキング順',
  trust: '信頼度順',
  distance: '距離順',
  price: '値段順',
};

const FALLBACK_PIN_POSITIONS: PinPosition[] = [
  { x: 58, y: 22 },
  { x: 25, y: 45 },
  { x: 68, y: 66 },
];

const GOOGLE_MAPS_API_KEY =
  import.meta.env.MODE === 'test' ? '' : String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
const GOOGLE_MAP_ID = 'DEMO_MAP_ID';
const GOOGLE_MAPS_CALLBACK = '__initBottakuriGoogleMaps';

let googleMapsLoadPromise: Promise<GoogleMapsNamespace> | undefined;

interface NearbyRankingDashboardProps {
  report: NearbyRankingReport;
  analyzedReport: AnalysisReport;
  onBack: () => void;
}

function formatDistance(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}km`;
  return `${Math.round(value)}m`;
}

function scoreStyle(score: number): string {
  if (score >= 70) return 'bg-red-50 text-red-700 border-red-100';
  if (score >= 40) return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-emerald-50 text-emerald-700 border-emerald-100';
}

function trustScoreStyle(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-red-600';
}

function rankBadgeStyle(rank: number): string {
  if (rank === 1) return 'bg-red-500 text-white ring-red-100';
  if (rank === 2) return 'bg-amber-500 text-white ring-amber-100';
  if (rank === 3) return 'bg-emerald-600 text-white ring-emerald-100';
  return 'bg-slate-100 text-slate-900 ring-slate-100';
}

function suspicionLabel(place: NearbyPlace): string {
  const normalizedLevel = String(place.suspicionLevel).trim().toLowerCase();
  if (normalizedLevel === 'very_high' || normalizedLevel === 'very-high' || normalizedLevel.includes('非常に高')) {
    return '非常に高';
  }
  if (normalizedLevel === 'high' || normalizedLevel === '高' || normalizedLevel.includes('高')) return '高';
  if (
    normalizedLevel === 'medium' ||
    normalizedLevel === 'middle' ||
    normalizedLevel === '中' ||
    normalizedLevel.includes('中')
  ) {
    return '中';
  }
  return '低';
}

function formatPriceRange(place: NearbyPlace): string {
  if (place.priceRange?.trim()) return place.priceRange.trim();

  if (typeof place.priceLevel === 'number' && Number.isFinite(place.priceLevel) && place.priceLevel > 0) {
    return '¥'.repeat(Math.min(Math.round(place.priceLevel), 3));
  }

  return '-';
}

function priceSortValue(place: NearbyPlace): number {
  if (typeof place.priceLevel === 'number' && Number.isFinite(place.priceLevel)) return place.priceLevel;
  const yenCount = (place.priceRange?.match(/¥/g) || []).length;
  return yenCount > 0 ? yenCount : Number.POSITIVE_INFINITY;
}

function sortPlaces(places: NearbyPlace[], sortOption: SortOption): NearbyPlace[] {
  return [...places].sort((a, b) => {
    if (sortOption === 'rank') {
      return a.rank - b.rank;
    }
    if (sortOption === 'distance') {
      return (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY);
    }
    if (sortOption === 'price') {
      return priceSortValue(a) - priceSortValue(b) || b.trustScore - a.trustScore;
    }
    return b.trustScore - a.trustScore || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
  });
}

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button, select, a, input, textarea'));
}

function isValidLocation(location?: { lat?: number; lng?: number }): location is { lat: number; lng: number } {
  return Boolean(location && Number.isFinite(location.lat) && Number.isFinite(location.lng));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculatePinPositions(
  origin: NearbyRankingReport['origin']['location'],
  places: NearbyPlace[],
): PinPosition[] {
  if (!isValidLocation(origin)) {
    return places.map((_, index) => FALLBACK_PIN_POSITIONS[index] || FALLBACK_PIN_POSITIONS[0]);
  }

  const deltas = places.map((place) => {
    if (!isValidLocation(place.location)) return undefined;
    return {
      x: place.location.lng - origin.lng,
      y: origin.lat - place.location.lat,
    };
  });
  const maxDelta = Math.max(
    ...deltas
      .filter((delta): delta is { x: number; y: number } => Boolean(delta))
      .flatMap((delta) => [Math.abs(delta.x), Math.abs(delta.y)]),
  );

  if (!Number.isFinite(maxDelta) || maxDelta < 0.000001) {
    return places.map((_, index) => FALLBACK_PIN_POSITIONS[index] || FALLBACK_PIN_POSITIONS[0]);
  }

  return places.map((_, index) => {
    const delta = deltas[index];
    if (!delta) return FALLBACK_PIN_POSITIONS[index] || FALLBACK_PIN_POSITIONS[0];

    return {
      x: clamp(50 + (delta.x / maxDelta) * 32, 10, 90),
      y: clamp(50 + (delta.y / maxDelta) * 32, 10, 90),
    };
  });
}

function safeGoogleMapsUrl(url?: string): string | undefined {
  if (!url) return undefined;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') return undefined;

    const hostname = parsedUrl.hostname.replace(/^www\./, '');
    const isGoogleMapsHost = hostname === 'google.com' || hostname === 'maps.google.com';
    const isMapsPath = parsedUrl.pathname === '/maps' || parsedUrl.pathname.startsWith('/maps/');
    const hasApiKey = Array.from(parsedUrl.searchParams.keys()).some((key) => key.toLowerCase() === 'key');
    if (isGoogleMapsHost && isMapsPath && !hasApiKey) return parsedUrl.toString();
  } catch {
    return undefined;
  }

  return undefined;
}

function safeWorkerMapImageUrl(url?: string, apiBaseUrl = API_BASE_URL): string | undefined {
  if (!url) return undefined;

  try {
    const baseUrl = apiBaseUrl.startsWith('http')
      ? apiBaseUrl
      : new URL(apiBaseUrl, typeof window === 'undefined' ? 'http://localhost' : window.location.origin).toString();
    const apiBase = new URL(baseUrl);
    const parsedUrl = new URL(url, baseUrl);
    const isRelativeUrl = url.startsWith('/api/nearby-map');
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
    const isApiBaseHost = parsedUrl.hostname === apiBase.hostname;
    const hasApiKey = Array.from(parsedUrl.searchParams.keys()).some((key) => key.toLowerCase() === 'key');

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return undefined;
    if (!isLocalhost && parsedUrl.protocol !== apiBase.protocol) return undefined;
    if (parsedUrl.pathname !== '/api/nearby-map') return undefined;
    if (hasApiKey) return undefined;
    if (!isRelativeUrl && !isLocalhost && !isApiBaseHost) return undefined;
    if (isRelativeUrl && !isLocalhost && !isApiBaseHost) return undefined;

    return parsedUrl.toString();
  } catch {
    return undefined;
  }
}

function safeGoogleMapsEmbedUrl(url?: string): string | undefined {
  if (!url) return undefined;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') return undefined;
    if (parsedUrl.hostname !== 'www.google.com') return undefined;
    if (!parsedUrl.pathname.startsWith('/maps')) return undefined;
    if (parsedUrl.searchParams.get('output') !== 'embed') return undefined;
    if (parsedUrl.searchParams.has('key')) return undefined;

    return parsedUrl.toString();
  } catch {
    return undefined;
  }
}

function getMapUrl(place: NearbyPlace): string | undefined {
  const queryText = [place.placeName || place.name, place.address].filter(Boolean).join(' ').trim();
  const workerMapUrl = safeGoogleMapsUrl(place.mapUrl);

  if (workerMapUrl) return workerMapUrl;

  if (place.placeId) {
    const query = encodeURIComponent(queryText || place.placeId);
    const placeId = encodeURIComponent(place.placeId);
    return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`;
  }

  if (isValidLocation(place.location)) {
    return `https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}`;
  }

  if (queryText) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryText)}`;
  }

  return safeGoogleMapsUrl(place.mapUrl);
}

function isRadiusExpansionWarning(warning: string): boolean {
  return /半径.*拡大しました/.test(warning) || /まで拡大しました/.test(warning);
}

function buildCandidateAnalysisQuery(place: NearbyPlace): string {
  const queryParts = [place.placeName || place.name, place.address].filter(Boolean);
  const query = queryParts.join(' ').replace(/\s+/g, ' ').trim();

  if (query.length <= 80) return query;
  return (place.placeName || place.name || query).slice(0, 80);
}

function buildNearbyMapImageUrl(
  origin: NearbyRankingReport['origin']['location'],
  places: NearbyPlace[],
): string | undefined {
  if (!isValidLocation(origin)) return undefined;

  const pins = places
    .slice(0, 3)
    .flatMap((place) =>
      isValidLocation(place.location)
        ? [`${place.rank},${place.location.lat.toFixed(6)},${place.location.lng.toFixed(6)}`]
        : [],
    );
  if (pins.length === 0) return undefined;

  const params = new URLSearchParams({
    originLat: origin.lat.toFixed(6),
    originLng: origin.lng.toFixed(6),
    pins: pins.join('|'),
  });
  return `/api/nearby-map?${params.toString()}`;
}

function openMap(place: NearbyPlace, event?: MouseEvent<HTMLElement>): void {
  event?.preventDefault();
  event?.stopPropagation();

  const url = getMapUrl(place);
  if (!url) return;

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
}

function openLocationMap(location: { lat: number; lng: number }): void {
  const opened = window.open(
    `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`,
    '_blank',
    'noopener,noreferrer',
  );
  if (opened) opened.opener = null;
}

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsNamespace> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in the browser.'));
  }

  if (window.google?.maps?.Map) {
    return Promise.resolve(window.google.maps);
  }

  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const previousAuthFailure = window.gm_authFailure;
    let isSettled = false;
    const timeoutId = window.setTimeout(() => {
      settle(new Error('Google Maps script load timed out.'));
    }, 8000);

    function settle(error?: Error) {
      if (isSettled) return;
      isSettled = true;
      window.clearTimeout(timeoutId);
      if (error) {
        googleMapsLoadPromise = undefined;
        reject(error);
        return;
      }
      const maps = window.google?.maps;
      if (maps?.Map) {
        resolve(maps);
        return;
      }
      googleMapsLoadPromise = undefined;
      reject(new Error('Google Maps failed to initialize.'));
    }

    window.__initBottakuriGoogleMaps = () => {
      settle();
    };
    window.gm_authFailure = () => {
      if (previousAuthFailure) previousAuthFailure();
      settle(new Error('Google Maps authentication failed.'));
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-bottakuri-google-maps]');
    if (existingScript) {
      existingScript.addEventListener(
        'error',
        () => {
          settle(new Error('Google Maps script failed to load.'));
        },
        { once: true },
      );
      return;
    }

    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      libraries: 'marker',
      loading: 'async',
      callback: GOOGLE_MAPS_CALLBACK,
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.bottakuriGoogleMaps = 'true';
    script.onerror = () => {
      settle(new Error('Google Maps script failed to load.'));
    };
    document.head.appendChild(script);
  });

  return googleMapsLoadPromise;
}

type GoogleMarkerKind = 'rank' | 'current-location' | 'origin-place';

function createRankMarkerContent(label: string, color: string, size = 44): HTMLElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.textContent = label;
  marker.style.width = `${size}px`;
  marker.style.height = `${size}px`;
  marker.style.borderRadius = '9999px';
  marker.style.border = '4px solid #fff';
  marker.style.background = color;
  marker.style.color = '#fff';
  marker.style.fontWeight = '900';
  marker.style.fontSize = size >= 40 ? '20px' : '13px';
  marker.style.lineHeight = '1';
  marker.style.display = 'flex';
  marker.style.alignItems = 'center';
  marker.style.justifyContent = 'center';
  marker.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.28)';
  marker.style.cursor = 'pointer';
  marker.style.padding = '0';
  marker.style.fontFamily = 'inherit';
  return marker;
}

function getOriginMarkerSvg(kind: Exclude<GoogleMarkerKind, 'rank'>): string {
  const isCurrentLocation = kind === 'current-location';
  return isCurrentLocation
    ? `<svg viewBox="0 0 40 40" width="40" height="40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="16" fill="#2563eb" stroke="#ffffff" stroke-width="5"/><path fill="#ffffff" d="M20 20.8c3.2 0 5.8-2.6 5.8-5.8S23.2 9.2 20 9.2s-5.8 2.6-5.8 5.8 2.6 5.8 5.8 5.8Zm0 2.6c-5 0-9 2.9-9 6.4 0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2 0-3.5-4-6.4-9-6.4Z"/></svg>`
    : `<svg viewBox="0 0 42 52" width="42" height="52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="#0f172a" stroke="#ffffff" stroke-width="4" d="M21 3C11.6 3 4 10.6 4 20c0 12.8 17 29 17 29s17-16.2 17-29C38 10.6 30.4 3 21 3Z"/><circle cx="21" cy="20" r="9" fill="#ffffff"/><path fill="none" stroke="#2563eb" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M17 25V14h9l-2.2 3 2.2 3h-9"/></svg>`;
}

function createOriginMarkerContent(kind: Exclude<GoogleMarkerKind, 'rank'>): HTMLElement {
  const isCurrentLocation = kind === 'current-location';
  const marker = document.createElement('div');
  marker.setAttribute('role', 'img');
  marker.setAttribute('aria-label', isCurrentLocation ? '現在位置' : '起点');
  marker.style.width = isCurrentLocation ? '40px' : '42px';
  marker.style.height = isCurrentLocation ? '40px' : '52px';
  marker.style.display = 'flex';
  marker.style.alignItems = 'center';
  marker.style.justifyContent = 'center';
  marker.style.filter = 'drop-shadow(0 12px 18px rgba(15, 23, 42, 0.32))';
  marker.innerHTML = getOriginMarkerSvg(kind);
  return marker;
}

function createLegacyOriginMarkerIcon(
  maps: GoogleMapsNamespace,
  kind: Exclude<GoogleMarkerKind, 'rank'>,
): GoogleLegacyMarkerIcon {
  const isCurrentLocation = kind === 'current-location';
  const width = isCurrentLocation ? 40 : 42;
  const height = isCurrentLocation ? 40 : 52;
  const icon: GoogleLegacyMarkerIcon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(getOriginMarkerSvg(kind))}`,
  };
  if (maps.Size) icon.scaledSize = new maps.Size(width, height);
  if (maps.Point) icon.anchor = new maps.Point(isCurrentLocation ? 20 : 21, isCurrentLocation ? 20 : 49);
  return icon;
}

function createGoogleMarker(
  maps: GoogleMapsNamespace,
  options: {
    map: GoogleMapInstance;
    position: { lat: number; lng: number };
    label: string;
    title: string;
    color: string;
    zIndex: number;
    onClick?: () => void;
    size?: number;
    kind?: GoogleMarkerKind;
  },
): { marker: GoogleMarkerInstance; cleanup: () => void } {
  const AdvancedMarkerElement = maps.marker?.AdvancedMarkerElement;
  if (AdvancedMarkerElement) {
    const kind = options.kind || 'rank';
    const content =
      kind === 'rank'
        ? createRankMarkerContent(options.label, options.color, options.size)
        : createOriginMarkerContent(kind);
    const handleClick = () => options.onClick?.();
    if (options.onClick) {
      content.addEventListener('click', handleClick);
      content.style.cursor = 'pointer';
    }
    const marker = new AdvancedMarkerElement({
      map: options.map,
      position: options.position,
      title: options.title,
      content,
      zIndex: options.zIndex,
    });
    return {
      marker,
      cleanup: () => {
        if (options.onClick) content.removeEventListener('click', handleClick);
        marker.map = null;
      },
    };
  }

  if (maps.Marker) {
    const kind = options.kind || 'rank';
    const marker = new maps.Marker({
      map: options.map,
      position: options.position,
      title: options.title,
      ...(kind === 'rank'
        ? {
            label: {
              text: options.label,
              color: '#fff',
              fontWeight: '900',
            },
          }
        : {
            icon: createLegacyOriginMarkerIcon(maps, kind),
          }),
      zIndex: options.zIndex,
    });
    return {
      marker,
      cleanup: () => {
        marker.map = null;
      },
    };
  }

  throw new Error('Google Maps marker support is unavailable.');
}

const RankedGoogleMap: FC<{
  origin: NearbyRankingReport['origin'];
  places: NearbyPlace[];
  title: string;
  className: string;
  onOpenPlace: (place: NearbyPlace) => void;
  onUnavailable: () => void;
}> = ({ origin, places, title, className, onOpenPlace, onUnavailable }) => {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const cleanupCallbacks: Array<() => void> = [];
    const mapElement = mapRef.current;

    async function initializeMap() {
      if (!GOOGLE_MAPS_API_KEY || !mapElement || !isValidLocation(origin.location)) {
        onUnavailable();
        return;
      }

      const visiblePlaces = places.filter((place) => isValidLocation(place.location)).slice(0, 3);
      if (visiblePlaces.length === 0) {
        onUnavailable();
        return;
      }

      try {
        const maps = await loadGoogleMaps(GOOGLE_MAPS_API_KEY);
        if (isCancelled) return;

        mapElement.innerHTML = '';
        const map = new maps.Map(mapElement, {
          center: origin.location,
          zoom: 15,
          mapId: GOOGLE_MAP_ID,
          gestureHandling: 'greedy',
          clickableIcons: true,
          disableDefaultUI: false,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
        });

        const bounds = new maps.LatLngBounds();
        bounds.extend(origin.location);
        for (const place of visiblePlaces) {
          if (isValidLocation(place.location)) bounds.extend(place.location);
        }
        map.fitBounds(bounds, 64);

        window.setTimeout(() => {
          if (isCancelled) return;
          const zoom = map.getZoom();
          if (typeof zoom === 'number' && zoom > 17) map.setZoom(17);
        }, 0);

        cleanupCallbacks.push(
          createGoogleMarker(maps, {
            map,
            position: origin.location,
            label: origin.type === 'current_location' ? '現' : '起',
            title: origin.placeName || '起点',
            color: '#2563eb',
            zIndex: 20,
            size: 36,
            kind: origin.type === 'current_location' ? 'current-location' : 'origin-place',
          }).cleanup,
        );

        visiblePlaces.forEach((place) => {
          if (!isValidLocation(place.location)) return;
          cleanupCallbacks.push(
            createGoogleMarker(maps, {
              map,
              position: place.location,
              label: String(place.rank),
              title: place.placeName,
              color: place.rank === 1 ? '#ef4444' : place.rank === 2 ? '#f59e0b' : '#059669',
              zIndex: 30 - place.rank,
              onClick: () => onOpenPlace(place),
            }).cleanup,
          );
        });
      } catch {
        if (!isCancelled) onUnavailable();
      }
    }

    void initializeMap();

    return () => {
      isCancelled = true;
      cleanupCallbacks.forEach((cleanup) => cleanup());
      if (mapElement) mapElement.innerHTML = '';
    };
  }, [onOpenPlace, onUnavailable, origin, places]);

  return <div ref={mapRef} title={title} className={className} />;
};

const NearbyRankingDashboard: FC<NearbyRankingDashboardProps> = ({ report, onBack }) => {
  const rankedTopThree = useMemo(() => sortPlaces(report.places, 'rank').slice(0, 3), [report.places]);
  const [sortOption, setSortOption] = useState<SortOption>('rank');
  const displayedPlaces = useMemo(() => sortPlaces(report.places, sortOption), [report.places, sortOption]);
  const displayedTopThree = useMemo(() => displayedPlaces.slice(0, 3), [displayedPlaces]);
  const displayedRest = useMemo(() => displayedPlaces.slice(3, 10), [displayedPlaces]);
  const topThree = displayedTopThree;
  const topPinPositions = useMemo(
    () => calculatePinPositions(report.origin.location, topThree),
    [report.origin.location, topThree],
  );
  const generatedMapImageUrl = useMemo(
    () => buildNearbyMapImageUrl(report.origin.location, topThree),
    [report.origin.location, topThree],
  );
  const mapImageUrl = useMemo(
    () =>
      (sortOption === 'rank' ? safeWorkerMapImageUrl(report.mapImageUrl) : undefined) ||
      safeWorkerMapImageUrl(generatedMapImageUrl),
    [generatedMapImageUrl, report.mapImageUrl, sortOption],
  );
  const mapEmbedUrl = useMemo(() => safeGoogleMapsEmbedUrl(report.mapEmbedUrl), [report.mapEmbedUrl]);
  const [isMapImageUnavailable, setIsMapImageUnavailable] = useState(false);
  const [isGoogleMapUnavailable, setIsGoogleMapUnavailable] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | undefined>(rankedTopThree[0] || report.places[0]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisReport | undefined>(undefined);
  const [analysisError, setAnalysisError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(true);
  const analysisSectionRef = useRef<HTMLDivElement | null>(null);
  const sheetDragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedPlace(rankedTopThree[0] || report.places[0]);
    setSelectedAnalysis(undefined);
    setAnalysisError('');
    setIsMobileSheetExpanded(true);
    setSortOption('rank');
  }, [report, rankedTopThree]);

  useEffect(() => {
    setIsMapImageUnavailable(false);
    setIsGoogleMapUnavailable(false);
  }, [mapImageUrl, report]);

  const originLabel = report.origin.type === 'analyzed_place' ? '分析した店を起点' : '現在位置を起点';
  const originName = report.origin.placeName || (report.origin.type === 'current_location' ? '現在位置' : '起点店舗');
  const originAddress = report.origin.address || '住所情報なし';
  const shouldShowMapImage = Boolean(mapImageUrl && !isMapImageUnavailable);
  const shouldShowInteractiveGoogleMap = Boolean(
    GOOGLE_MAPS_API_KEY &&
    !isGoogleMapUnavailable &&
    isValidLocation(report.origin.location) &&
    topThree.some((place) => isValidLocation(place.location)),
  );
  const shouldShowMapEmbed = Boolean(!shouldShowInteractiveGoogleMap && !shouldShowMapImage && mapEmbedUrl);
  const hasExternalMapVisual = shouldShowInteractiveGoogleMap || shouldShowMapImage || shouldShowMapEmbed;
  const shouldShowMobileMapEmbed = Boolean(!shouldShowInteractiveGoogleMap && mapEmbedUrl);
  const shouldShowMobileMapImage = Boolean(
    !shouldShowInteractiveGoogleMap && !shouldShowMobileMapEmbed && shouldShowMapImage,
  );
  const hasMobileExternalMapVisual =
    shouldShowInteractiveGoogleMap || shouldShowMobileMapImage || shouldShowMobileMapEmbed;
  const visibleWarnings = (report.meta.warnings || []).filter((warning) => !isRadiusExpansionWarning(warning));
  const handleGoogleMapUnavailable = useCallback(() => {
    setIsGoogleMapUnavailable(true);
  }, []);
  const handleOpenPlaceMap = useCallback((place: NearbyPlace) => {
    openMap(place);
  }, []);

  const scrollToAnalysisSection = () => {
    window.setTimeout(() => {
      const analysisElement = analysisSectionRef.current;
      if (typeof analysisElement?.scrollIntoView === 'function') {
        analysisElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  };

  const handleSelectCandidate = (place: NearbyPlace) => {
    setSelectedPlace(place);
    setSelectedAnalysis(undefined);
    setAnalysisError('');
  };

  const handleSheetDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (isInteractiveDragTarget(event.target)) return;
    sheetDragStartYRef.current = event.clientY;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handleSheetDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    const startY = sheetDragStartYRef.current;
    sheetDragStartYRef.current = null;
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (startY === null) return;

    const deltaY = event.clientY - startY;
    if (deltaY > 48) {
      setIsMobileSheetExpanded(false);
    } else if (deltaY < -48) {
      setIsMobileSheetExpanded(true);
    }
  };

  const handleAnalyzeCandidate = async (place: NearbyPlace, options: { shouldScroll?: boolean } = {}) => {
    if (isAnalyzing) return;

    setSelectedPlace(place);
    setSelectedAnalysis(undefined);
    setAnalysisError('');
    if (options.shouldScroll ?? true) {
      scrollToAnalysisSection();
    }

    if (place.analysisReport) {
      setSelectedAnalysis(place.analysisReport);
      return;
    }

    setIsAnalyzing(true);

    try {
      const result = await analyzePlace({
        query: buildCandidateAnalysisQuery(place),
        location: place.location,
      });
      setSelectedAnalysis(result);
    } catch {
      setAnalysisError('個別分析を取得できませんでした。通信状況を確認して、もう一度お試しください。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <motion.section
      key="nearby-ranking"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="hidden flex-col gap-4 lg:flex lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-fit shrink-0 space-y-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            元の1店舗分析へ戻る
          </button>
          <div>
            <div className="text-sm font-semibold text-blue-600">{originLabel}</div>
            <h1 className="text-2xl md:text-3xl font-bold leading-tight text-slate-900">
              <span className="block whitespace-nowrap">周辺の優良店ランキング</span>
            </h1>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px]">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold mb-1">
              <Navigation className="w-4 h-4 text-blue-500" />
              起点
            </div>
            <div className="font-bold text-slate-900 line-clamp-1">{originName}</div>
            <div className="text-xs text-slate-500 line-clamp-1">{originAddress}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold mb-1">
              <BarChart3 className="w-4 h-4 text-emerald-500" />
              候補数
            </div>
            <div className="font-bold text-slate-900">{report.places.length}店舗</div>
            <div className="text-xs text-slate-500">全店舗を個別分析できます</div>
          </div>
        </div>
      </div>

      {visibleWarnings.length > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {visibleWarnings.join(' / ')}
        </div>
      )}

      <div className="hidden gap-6 lg:grid lg:grid-cols-[minmax(520px,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4 lg:order-2">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">上位3マップ</h2>
              <span className="text-xs font-semibold text-slate-500">ピンで地図を開く</span>
            </div>
            <div className="relative h-[300px] overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(90deg,#e2e8f0_1px,transparent_1px),linear-gradient(#e2e8f0_1px,transparent_1px)] bg-[size:42px_42px]">
              {shouldShowInteractiveGoogleMap ? (
                <RankedGoogleMap
                  origin={report.origin}
                  places={topThree}
                  title="上位3店舗と起点を示す周辺マップ"
                  className="absolute inset-0 h-full w-full"
                  onOpenPlace={handleOpenPlaceMap}
                  onUnavailable={handleGoogleMapUnavailable}
                />
              ) : shouldShowMapImage ? (
                <img
                  src={mapImageUrl}
                  alt="上位3店舗と起点を示す周辺マップ"
                  className="absolute inset-0 h-full w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setIsMapImageUnavailable(true)}
                />
              ) : shouldShowMapEmbed ? (
                <iframe
                  src={mapEmbedUrl}
                  title="上位3店舗と起点を示す周辺マップ"
                  className="absolute inset-0 h-full w-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <>
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white/40 to-emerald-50" />
                  <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-lg">
                    <Navigation className="w-4 h-4" />
                    起点
                  </div>
                </>
              )}
              {!shouldShowInteractiveGoogleMap &&
                topThree.map((place, index) => {
                  const position = topPinPositions[index] || FALLBACK_PIN_POSITIONS[index] || FALLBACK_PIN_POSITIONS[0];
                  const mapUrl = getMapUrl(place);
                  return (
                    <button
                      key={place.id}
                      type="button"
                      onClick={(event) => openMap(place, event)}
                      disabled={!mapUrl}
                      data-testid={`nearby-map-pin-${place.rank}`}
                      style={{ left: `${position.x}%`, top: `${position.y}%` }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 group flex flex-col items-center ${
                        hasExternalMapVisual
                          ? 'h-14 w-14 rounded-full focus:outline-none focus:ring-4 focus:ring-blue-500/40'
                          : ''
                      }`}
                      aria-label={`${place.placeName}の地図を開く`}
                    >
                      {hasExternalMapVisual ? (
                        <span className="sr-only">{place.rank}位</span>
                      ) : (
                        <>
                          <span className="mb-1 rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-700 shadow-sm">
                            {place.rank}位
                          </span>
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-200 ring-4 ring-white group-hover:bg-indigo-600 disabled:bg-slate-300">
                            <MapPin className="w-6 h-6 fill-current" />
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
            </div>
            {hasExternalMapVisual && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {topThree.map((place) => (
                  <button
                    key={`map-link-${place.id}`}
                    type="button"
                    onClick={(event) => openMap(place, event)}
                    disabled={!getMapUrl(place)}
                    className="inline-flex min-h-10 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 hover:border-blue-200 hover:text-blue-700 disabled:text-slate-300"
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    {place.rank}位
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedPlace && (
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-blue-600">選択中</div>
                  <h2 className="text-lg font-bold text-slate-900">{selectedPlace.placeName}</h2>
                  <p className="mt-1 text-sm text-slate-500">{selectedPlace.address}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span
                    aria-label={suspicionLabel(selectedPlace)}
                    className={`rounded-full border px-3 py-1 text-xs font-bold ${scoreStyle(selectedPlace.sakuraScore)}`}
                  >
                    {suspicionLabel(selectedPlace)}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => openMap(selectedPlace, event)}
                    disabled={!getMapUrl(selectedPlace)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 disabled:text-slate-300"
                  >
                    <ExternalLink className="w-4 h-4" />
                    開く
                  </button>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{selectedPlace.summary}</p>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Google</div>
                  <div className="font-bold text-slate-900">{selectedPlace.googleRating.toFixed(1)}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">価格帯</div>
                  <div className="font-bold text-slate-900">{formatPriceRange(selectedPlace)}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">信頼度</div>
                  <div className={`font-bold ${trustScoreStyle(selectedPlace.trustScore)}`}>
                    {selectedPlace.trustScore}%
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleAnalyzeCandidate(selectedPlace)}
                disabled={isAnalyzing}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 sm:w-auto"
              >
                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                分析詳細を見る
              </button>
            </div>
          )}
        </div>

        <div className="hidden bg-white border border-slate-200 rounded-3xl shadow-sm lg:order-1 lg:block overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-5">
            <h2 className="font-bold text-slate-900">周辺10店舗ランキング</h2>
            <label className="relative inline-flex shrink-0 items-center text-sm font-bold text-slate-700">
              <span className="sr-only">PCランキングの並び順</span>
              <select
                value={sortOption}
                onChange={(event) => setSortOption(event.target.value as SortOption)}
                className="appearance-none rounded-full border border-slate-200 bg-white py-2 pl-4 pr-9 text-sm font-bold text-slate-700 shadow-sm"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500" />
            </label>
          </div>
          <div>
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[72px]" />
                <col />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[112px]" />
                <col className="w-[88px]" />
              </colgroup>
              <thead className="text-left text-xs font-bold uppercase text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-3">順位</th>
                  <th className="px-4 py-3">店舗</th>
                  <th className="px-4 py-3">価格帯</th>
                  <th className="px-4 py-3">信頼度</th>
                  <th className="px-4 py-3">サクラ疑い</th>
                  <th className="px-4 py-3">距離</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedPlaces.map((place, index) => (
                  <tr
                    key={place.id}
                    className="cursor-pointer transition-colors hover:bg-blue-50/60"
                    onClick={() => handleSelectCandidate(place)}
                  >
                    <td className="px-4 py-4 font-bold text-slate-900">#{index + 1}</td>
                    <td className="px-4 py-4">
                      <div className="line-clamp-2 break-words font-bold leading-snug text-slate-900">
                        {place.placeName}
                      </div>
                      <div className="mt-1 line-clamp-1 text-xs text-slate-500">{place.genre}</div>
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-700">{formatPriceRange(place)}</td>
                    <td className="px-4 py-4">
                      <div className={`flex items-center gap-1 font-bold ${trustScoreStyle(place.trustScore)}`}>
                        <Star className="w-4 h-4 fill-current" />
                        {place.trustScore}%
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        aria-label={suspicionLabel(place)}
                        className={`rounded-full border px-2 py-1 text-xs font-bold ${scoreStyle(place.sakuraScore)}`}
                      >
                        {suspicionLabel(place)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{formatDistance(place.distanceMeters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="lg:hidden -mx-4 overflow-hidden bg-white">
        <div
          className={`relative overflow-hidden bg-slate-100 transition-[height] duration-300 ${
            isMobileSheetExpanded ? 'h-[58svh] min-h-[430px] max-h-[560px]' : 'h-[calc(100svh-84px)] min-h-[560px]'
          }`}
        >
          {shouldShowInteractiveGoogleMap ? (
            <RankedGoogleMap
              origin={report.origin}
              places={topThree}
              title="モバイル周辺マップ"
              className="absolute inset-0 h-full w-full"
              onOpenPlace={handleOpenPlaceMap}
              onUnavailable={handleGoogleMapUnavailable}
            />
          ) : shouldShowMobileMapEmbed ? (
            <iframe
              src={mapEmbedUrl}
              title="モバイル周辺マップ"
              className="absolute inset-0 h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : shouldShowMobileMapImage ? (
            <img
              src={mapImageUrl}
              alt="モバイル周辺マップ"
              className="absolute inset-0 h-full w-full bg-slate-100 object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setIsMapImageUnavailable(true)}
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(203,213,225,0.7)_1px,transparent_1px),linear-gradient(rgba(203,213,225,0.7)_1px,transparent_1px)] bg-[size:44px_44px]" />
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/70 via-white/30 to-emerald-50/80" />
            </>
          )}
          <div className="pointer-events-none absolute inset-0 bg-white/10" />

          <button
            type="button"
            onClick={onBack}
            aria-label="戻る"
            className="absolute left-4 top-6 z-10 inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg shadow-slate-900/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => openLocationMap(report.origin.location)}
            className="absolute right-4 top-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-blue-600 shadow-lg shadow-slate-900/10"
            aria-label="起点を地図で開く"
          >
            <LocateFixed className="h-6 w-6" />
          </button>

          <div className="absolute left-1/2 top-6 z-10 w-[min(calc(100%-176px),440px)] -translate-x-1/2 rounded-2xl bg-white/95 px-3 py-3 text-center shadow-xl shadow-slate-900/10 backdrop-blur">
            <h1 className="text-base font-black leading-tight text-slate-900">周辺店舗ランキング</h1>
            <div className="mt-1 text-xs leading-relaxed text-slate-600">
              <div className="line-clamp-1">起点店舗: {originName}</div>
            </div>
          </div>

          {!hasMobileExternalMapVisual && report.origin.type === 'current_location' && (
            <div className="absolute left-[18%] top-[56%] z-10 -translate-x-1/2 text-center">
              <div className="mx-auto h-7 w-7 rounded-full border-4 border-white bg-blue-600 shadow-lg" />
              <div className="mt-1 text-xs font-bold text-blue-700 drop-shadow-sm">現在地</div>
            </div>
          )}

          {!hasMobileExternalMapVisual &&
            topThree.map((place, index) => {
              const position = topPinPositions[index] || FALLBACK_PIN_POSITIONS[index] || FALLBACK_PIN_POSITIONS[0];
              return (
                <button
                  key={`mobile-map-pin-${place.id}`}
                  type="button"
                  onClick={(event) => openMap(place, event)}
                  disabled={!getMapUrl(place)}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2 disabled:opacity-60"
                  aria-label={`${place.placeName}の地図を開く（モバイル）`}
                >
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-[20px] text-xl font-black shadow-xl ring-4 ${rankBadgeStyle(place.rank)}`}
                  >
                    {place.rank}
                  </span>
                </button>
              );
            })}

          {!hasMobileExternalMapVisual && (
            <div className="absolute bottom-5 left-1/2 z-10 inline-flex w-[min(calc(100%-64px),360px)] -translate-x-1/2 items-center justify-center gap-2 rounded-2xl bg-white/95 px-4 py-3 text-sm font-bold text-blue-600 shadow-lg shadow-slate-900/10">
              <MapPin className="h-5 w-5" />
              ピンを押すと地図アプリへ
            </div>
          )}
        </div>

        <div
          className="relative -mt-7 rounded-t-[32px] bg-white px-4 pb-8 pt-4 shadow-2xl shadow-slate-900/20"
          onPointerDown={handleSheetDragStart}
          onPointerUp={handleSheetDragEnd}
          onPointerCancel={() => {
            sheetDragStartYRef.current = null;
          }}
        >
          <div
            data-testid="mobile-ranking-sheet-handle"
            className="mx-auto mb-5 flex h-8 w-32 touch-none items-center justify-center rounded-full text-xs font-bold text-slate-500"
          >
            <span className="h-1.5 w-20 rounded-full bg-slate-300" />
          </div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-black tracking-normal text-slate-900">TOP10</h2>
            <label className="relative inline-flex items-center text-sm font-bold text-slate-700">
              <span className="sr-only">ランキングの並び順</span>
              <select
                value={sortOption}
                onChange={(event) => setSortOption(event.target.value as SortOption)}
                className="appearance-none rounded-full border border-slate-200 bg-white py-2 pl-4 pr-9 text-sm font-bold text-slate-700 shadow-sm"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500" />
            </label>
          </div>

          {isMobileSheetExpanded && (
            <>
              <div className="space-y-2">
                {displayedTopThree.map((place) => (
                  <div key={place.id} className="rounded-lg border border-emerald-200 bg-emerald-50/35 px-3 py-3">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-black shadow-sm ring-4 ${rankBadgeStyle(place.rank)}`}
                      >
                        {place.rank}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-base font-black text-slate-900">{place.placeName}</div>
                        <div className="truncate text-sm text-slate-500">
                          {place.genre} / {formatPriceRange(place)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAnalyzeCandidate(place, { shouldScroll: true })}
                        disabled={isAnalyzing}
                        aria-label={`${place.placeName}の分析詳細を見る`}
                        className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                      >
                        分析詳細
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                      <div className="text-slate-700">
                        <span>{formatDistance(place.distanceMeters)}</span>
                        <span className={`ml-4 font-bold ${trustScoreStyle(place.trustScore)}`}>
                          信頼 {place.trustScore}
                        </span>
                      </div>
                      <span
                        aria-label={suspicionLabel(place)}
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${scoreStyle(place.sakuraScore)}`}
                      >
                        サクラ疑い {suspicionLabel(place)}
                      </span>
                    </div>
                  </div>
                ))}

                {displayedRest.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => handleAnalyzeCandidate(place, { shouldScroll: true })}
                    disabled={isAnalyzing}
                    aria-label={`${place.placeName}の分析詳細を見る`}
                    className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-2 py-3 text-left disabled:opacity-60"
                  >
                    <div className="text-center text-xl font-black text-slate-900">{place.rank}</div>
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-slate-900">{place.placeName}</div>
                      <div className="truncate text-sm text-slate-500">
                        {place.genre} / {formatPriceRange(place)} / {formatDistance(place.distanceMeters)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="hidden text-right text-sm text-slate-700 min-[390px]:block">
                        <div className={`font-bold ${trustScoreStyle(place.trustScore)}`}>信頼 {place.trustScore}</div>
                        <div className="text-xs text-slate-500">{suspicionLabel(place)}</div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-900" />
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />※
                距離は現在地からの直線距離の目安です
              </div>
            </>
          )}
        </div>
      </div>

      {(isAnalyzing || analysisError || selectedAnalysis) && (
        <div ref={analysisSectionRef} className="scroll-mt-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
            {isAnalyzing && <Loader2 className="w-4 h-4 animate-spin" />}
            {isAnalyzing ? '個別分析を取得中です' : '選択店舗の個別分析'}
          </div>
          {analysisError && (
            <div className="flex flex-col gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 sm:flex-row sm:items-center sm:justify-between">
              <span>{analysisError}</span>
              {selectedPlace && (
                <button
                  type="button"
                  onClick={() => handleAnalyzeCandidate(selectedPlace)}
                  disabled={isAnalyzing}
                  className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  再試行
                </button>
              )}
            </div>
          )}
          {selectedAnalysis && (
            <AnalysisDashboard
              data={selectedAnalysis}
              onReset={() => setSelectedAnalysis(undefined)}
              showNearbyCta={false}
              showResetAction={false}
            />
          )}
        </div>
      )}
    </motion.section>
  );
};

export default NearbyRankingDashboard;
