import { PLACES_API_TIMEOUT_MS } from '../constants';
import { Env } from '../types';
import { fetchWithTimeout } from '../utils/http';
import { ApiHttpError } from '../utils/response';
import { clampNumber, toFiniteNumber } from '../utils/validation';

const MAX_STATIC_MAP_PINS = 3;
const STATIC_MAP_CACHE_SECONDS = 300;

interface MapPin {
  rank: number;
  lat: number;
  lng: number;
}

export async function handleNearbyMap(
  request: Request,
  env: Env,
  allowedOrigin: string | null,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = parseCoordinatePair(url.searchParams.get('originLat'), url.searchParams.get('originLng'));
  if (!origin) {
    throw new ApiHttpError('INVALID_QUERY', 400, '有効な起点座標を指定してください。');
  }

  const pins = parsePins(url.searchParams.get('pins'));
  if (pins.length === 0) {
    throw new ApiHttpError('INVALID_QUERY', 400, '有効なピン座標を指定してください。');
  }

  const staticMapUrl = buildStaticMapUrl(origin, pins, env.GOOGLE_PLACES_API_KEY);
  const upstream = await fetchWithTimeout(
    staticMapUrl,
    { method: 'GET' },
    {
      timeoutMs: PLACES_API_TIMEOUT_MS,
      onTimeout: () => new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Maps Static APIの応答がタイムアウトしました。'),
      onError: () => new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Maps Static API取得に失敗しました。'),
      consume: async (response) => response,
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await readSafeUpstreamError(upstream);
    console.warn(
      JSON.stringify({
        level: 'warn',
        source: 'google_maps_static',
        status: upstream.status,
        statusText: upstream.statusText,
        detail,
      }),
    );
    throw new ApiHttpError(
      'UPSTREAM_ERROR',
      502,
      `Google Maps Static API取得に失敗しました。upstreamStatus=${upstream.status}${
        detail ? ` upstreamMessage=${detail}` : ''
      }`,
    );
  }

  const headers = new Headers({
    'Content-Type': upstream.headers.get('Content-Type') || 'image/png',
    'Cache-Control': `public, max-age=${STATIC_MAP_CACHE_SECONDS}`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });

  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Vary', 'Origin');
  }
  headers.set('X-Request-Id', requestId);

  return new Response(upstream.body, { status: 200, headers });
}

function buildStaticMapUrl(origin: { lat: number; lng: number }, pins: MapPin[], apiKey: string): string {
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('size', '640x360');
  url.searchParams.set('scale', '2');
  url.searchParams.set('maptype', 'roadmap');
  url.searchParams.append('markers', `color:red|label:S|${origin.lat},${origin.lng}`);
  url.searchParams.append('visible', `${origin.lat},${origin.lng}`);

  for (const pin of pins) {
    url.searchParams.append('markers', `color:blue|label:${pin.rank}|${pin.lat},${pin.lng}`);
    url.searchParams.append('visible', `${pin.lat},${pin.lng}`);
  }

  url.searchParams.set('key', apiKey);
  return url.toString();
}

function parsePins(rawPins: string | null): MapPin[] {
  if (!rawPins || rawPins.length > 500) return [];
  const pins: MapPin[] = [];
  for (const rawPin of rawPins.split('|')) {
    const [rankRaw, latRaw, lngRaw] = rawPin.split(',');
    const rank = Math.round(toFiniteNumber(rankRaw) ?? 0);
    const coordinate = parseCoordinatePair(latRaw, lngRaw);
    if (!coordinate || rank < 1 || rank > 3) continue;
    pins.push({ rank, ...coordinate });
    if (pins.length >= MAX_STATIC_MAP_PINS) break;
  }
  return pins;
}

function parseCoordinatePair(
  latRaw: string | null | undefined,
  lngRaw: string | null | undefined,
): { lat: number; lng: number } | null {
  const lat = toFiniteNumber(latRaw);
  const lng = toFiniteNumber(lngRaw);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat: roundTo(clampNumber(lat, -90, 90), 6),
    lng: roundTo(clampNumber(lng, -180, 180), 6),
  };
}

async function readSafeUpstreamError(response: Response): Promise<string> {
  try {
    const text = (await response.clone().text()).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return redactSecrets(text).slice(0, 240);
  } catch {
    return response.statusText ? redactSecrets(response.statusText).slice(0, 120) : '';
  }
}

function redactSecrets(value: string): string {
  return value.replace(/key=([^&\s]+)/gi, 'key=REDACTED').replace(/AIza[0-9A-Za-z_-]{20,}/g, 'REDACTED');
}

function roundTo(value: number, digits: number): number {
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}
