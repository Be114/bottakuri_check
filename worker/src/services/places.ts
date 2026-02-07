import { PLACES_API_TIMEOUT_MS } from '../constants';
import { PlaceData, PlaceReview, Env } from '../types';
import { ApiHttpError } from '../utils/response';
import { clampNumber, toFiniteNumber } from '../utils/validation';

export async function fetchPlaceData(
  query: string,
  location: { lat: number; lng: number } | undefined,
  env: Env,
  reviewSampleLimit: number
): Promise<PlaceData> {
  const searchBody: Record<string, unknown> = {
    textQuery: query,
    languageCode: 'ja',
    maxResultCount: 1,
  };

  if (location) {
    searchBody.locationBias = {
      circle: {
        center: {
          latitude: location.lat,
          longitude: location.lng,
        },
        radius: 5000,
      },
    };
  }

  let searchResponse: Response;
  try {
    searchResponse = await fetchWithTimeout(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location',
        },
        body: JSON.stringify(searchBody),
      },
      PLACES_API_TIMEOUT_MS
    );
  } catch (error) {
    if (error instanceof ApiHttpError) throw error;
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API検索に失敗しました。');
  }

  if (!searchResponse.ok) {
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API検索に失敗しました。');
  }

  const searchJson = (await searchResponse.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      rating?: number;
      userRatingCount?: number;
      location?: { latitude?: number; longitude?: number };
    }>;
  };

  const candidate = searchJson.places?.[0];
  const placeId = candidate?.id;
  if (!placeId) {
    throw new ApiHttpError('UPSTREAM_ERROR', 404, '対象の店舗情報が見つかりませんでした。');
  }

  const detailsUrl = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  detailsUrl.searchParams.set('languageCode', 'ja');

  let detailsResponse: Response;
  try {
    detailsResponse = await fetchWithTimeout(
      detailsUrl.toString(),
      {
        headers: {
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,rating,userRatingCount,reviews,location',
        },
      },
      PLACES_API_TIMEOUT_MS
    );
  } catch (error) {
    if (error instanceof ApiHttpError) throw error;
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API詳細取得に失敗しました。');
  }

  if (!detailsResponse.ok) {
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API詳細取得に失敗しました。');
  }

  const detailsJson = (await detailsResponse.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    location?: { latitude?: number; longitude?: number };
    reviews?: Array<{
      rating?: number;
      text?: { text?: string };
      publishTime?: string;
      authorAttribution?: { displayName?: string };
    }>;
  };

  const reviews = (detailsJson.reviews || [])
    .slice(0, reviewSampleLimit)
    .map((review): PlaceReview => ({
      rating: clampNumber(toFiniteNumber(review.rating) ?? 0, 0, 5),
      text: normalizeReviewText(review.text?.text),
      authorName: review.authorAttribution?.displayName,
      publishTime: review.publishTime,
    }))
    .filter((review) => review.text.length > 0);

  return {
    placeId,
    name: detailsJson.displayName?.text || candidate.displayName?.text || query,
    address: detailsJson.formattedAddress || candidate.formattedAddress || '住所不明',
    googleRating: clampNumber(
      toFiniteNumber(detailsJson.rating) ?? toFiniteNumber(candidate.rating) ?? 0,
      0,
      5
    ),
    userRatingCount: Math.max(
      0,
      Math.round(toFiniteNumber(detailsJson.userRatingCount) ?? toFiniteNumber(candidate.userRatingCount) ?? 0)
    ),
    reviews,
    location: normalizePlaceLocation(detailsJson.location, candidate.location),
  };
}

function normalizePlaceLocation(
  primary?: { latitude?: number; longitude?: number },
  fallback?: { latitude?: number; longitude?: number }
): { lat: number; lng: number } | undefined {
  const lat = toFiniteNumber(primary?.latitude) ?? toFiniteNumber(fallback?.latitude);
  const lng = toFiniteNumber(primary?.longitude) ?? toFiniteNumber(fallback?.longitude);
  if (lat === null || lng === null) return undefined;
  return { lat, lng };
}

function normalizeReviewText(text?: string): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places APIの応答がタイムアウトしました。');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
