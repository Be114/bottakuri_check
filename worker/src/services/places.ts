import { PLACES_API_TIMEOUT_MS } from '../constants';
import { PlaceData, PlaceReview, Env } from '../types';
import { fetchJsonWithTimeout } from '../utils/http';
import { ApiHttpError } from '../utils/response';
import { clampNumber, toFiniteNumber } from '../utils/validation';

type PlacesSearchResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    location?: { latitude?: number; longitude?: number };
  }>;
};

type PlacesDetailsResponse = {
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

export async function fetchPlaceData(
  query: string,
  location: { lat: number; lng: number } | undefined,
  env: Env,
  reviewSampleLimit: number,
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

  let searchResult: { response: Response; json: PlacesSearchResponse | null };
  try {
    searchResult = await fetchJsonWithTimeout<PlacesSearchResponse>(
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
      {
        timeoutMs: PLACES_API_TIMEOUT_MS,
        onTimeout: () => new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places APIの応答がタイムアウトしました。'),
      },
    );
  } catch (error) {
    if (error instanceof ApiHttpError) throw error;
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API検索に失敗しました。');
  }

  if (!searchResult.response.ok || !searchResult.json) {
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API検索に失敗しました。');
  }

  const searchJson = searchResult.json;

  const candidate = searchJson.places?.[0];
  const placeId = candidate?.id;
  if (!placeId) {
    throw new ApiHttpError('UPSTREAM_ERROR', 404, '対象の店舗情報が見つかりませんでした。');
  }

  const detailsUrl = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  detailsUrl.searchParams.set('languageCode', 'ja');

  let detailsResult: { response: Response; json: PlacesDetailsResponse | null };
  try {
    detailsResult = await fetchJsonWithTimeout<PlacesDetailsResponse>(
      detailsUrl.toString(),
      {
        headers: {
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,reviews,location',
        },
      },
      {
        timeoutMs: PLACES_API_TIMEOUT_MS,
        onTimeout: () => new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places APIの応答がタイムアウトしました。'),
      },
    );
  } catch (error) {
    if (error instanceof ApiHttpError) throw error;
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API詳細取得に失敗しました。');
  }

  if (!detailsResult.response.ok || !detailsResult.json) {
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API詳細取得に失敗しました。');
  }

  const detailsJson = detailsResult.json;

  const reviews = (detailsJson.reviews || [])
    .slice(0, reviewSampleLimit)
    .map(
      (review): PlaceReview => ({
        rating: clampNumber(toFiniteNumber(review.rating) ?? 0, 0, 5),
        text: normalizeReviewText(review.text?.text),
        authorName: review.authorAttribution?.displayName,
        publishTime: review.publishTime,
      }),
    )
    .filter((review) => review.text.length > 0);

  return {
    placeId,
    name: detailsJson.displayName?.text || candidate.displayName?.text || query,
    address: detailsJson.formattedAddress || candidate.formattedAddress || '住所不明',
    googleRating: clampNumber(toFiniteNumber(detailsJson.rating) ?? toFiniteNumber(candidate.rating) ?? 0, 0, 5),
    userRatingCount: Math.max(
      0,
      Math.round(toFiniteNumber(detailsJson.userRatingCount) ?? toFiniteNumber(candidate.userRatingCount) ?? 0),
    ),
    reviews,
    location: normalizePlaceLocation(detailsJson.location, candidate.location),
  };
}

function normalizePlaceLocation(
  primary?: { latitude?: number; longitude?: number },
  fallback?: { latitude?: number; longitude?: number },
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
