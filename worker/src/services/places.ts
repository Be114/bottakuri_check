import { PLACES_API_TIMEOUT_MS } from '../constants';
import { PlaceData, PlacePriceLevel, PlacePriceRange, PlaceReview, Env, NearbyPlaceData } from '../types';
import { fetchJsonWithTimeout } from '../utils/http';
import { ApiHttpError } from '../utils/response';
import { clampNumber, toFiniteNumber } from '../utils/validation';

type PlacesSearchResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    primaryType?: string;
    primaryTypeDisplayName?: { text?: string };
    types?: string[];
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    priceRange?: unknown;
    location?: { latitude?: number; longitude?: number };
  }>;
};

type PlacesDetailsResponse = {
  id?: string;
  displayName?: { text?: string };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  priceRange?: unknown;
  location?: { latitude?: number; longitude?: number };
  reviews?: Array<{
    rating?: number;
    text?: { text?: string };
    publishTime?: string;
    authorAttribution?: { displayName?: string };
  }>;
};

type PlacesNearbyResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    primaryType?: string;
    primaryTypeDisplayName?: { text?: string };
    types?: string[];
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    priceRange?: unknown;
    location?: { latitude?: number; longitude?: number };
  }>;
};

export interface NearbyGenreFilter {
  label: string;
  includedPrimaryTypes: string[];
  requestedTerms: string[];
  isFallback: boolean;
  strictMatchTerms: string[];
}

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
            'places.id,places.displayName,places.primaryType,places.primaryTypeDisplayName,places.types,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.priceRange,places.location',
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
          'X-Goog-FieldMask':
            'id,displayName,primaryType,primaryTypeDisplayName,types,formattedAddress,rating,userRatingCount,priceLevel,priceRange,reviews,location',
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
    genre: detailsJson.primaryTypeDisplayName?.text || candidate.primaryTypeDisplayName?.text,
    primaryType: detailsJson.primaryType || candidate.primaryType,
    types: normalizeTypes(detailsJson.types || candidate.types, detailsJson.primaryType || candidate.primaryType),
    categories: normalizeCategories(
      detailsJson.primaryTypeDisplayName?.text || candidate.primaryTypeDisplayName?.text,
      detailsJson.primaryType || candidate.primaryType,
      detailsJson.types || candidate.types,
    ),
    googleRating: clampNumber(toFiniteNumber(detailsJson.rating) ?? toFiniteNumber(candidate.rating) ?? 0, 0, 5),
    userRatingCount: Math.max(
      0,
      Math.round(toFiniteNumber(detailsJson.userRatingCount) ?? toFiniteNumber(candidate.userRatingCount) ?? 0),
    ),
    ...(normalizePriceLevel(detailsJson.priceLevel || candidate.priceLevel)
      ? { priceLevel: normalizePriceLevel(detailsJson.priceLevel || candidate.priceLevel) }
      : {}),
    ...(normalizePriceRange(detailsJson.priceRange || candidate.priceRange)
      ? { priceRange: normalizePriceRange(detailsJson.priceRange || candidate.priceRange) }
      : {}),
    reviews,
    location: normalizePlaceLocation(detailsJson.location, candidate.location),
  };
}

export async function fetchNearbyRestaurants(
  location: { lat: number; lng: number },
  radiusMeters: number,
  env: Env,
  maxResultCount = 10,
  genreFilter: NearbyGenreFilter = buildNearbyGenreFilter(),
): Promise<NearbyPlaceData[]> {
  const searchBody = {
    includedPrimaryTypes: genreFilter.includedPrimaryTypes,
    maxResultCount: clampNearbyResultCount(maxResultCount),
    languageCode: 'ja',
    rankPreference: 'POPULARITY',
    locationRestriction: {
      circle: {
        center: {
          latitude: location.lat,
          longitude: location.lng,
        },
        radius: radiusMeters,
      },
    },
  };

  let result: { response: Response; json: PlacesNearbyResponse | null };
  try {
    result = await fetchJsonWithTimeout<PlacesNearbyResponse>(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.primaryType,places.primaryTypeDisplayName,places.types,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.priceRange,places.location',
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
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API周辺検索に失敗しました。');
  }

  if (!result.response.ok || !result.json) {
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API周辺検索に失敗しました。');
  }

  return (result.json.places || [])
    .map((place): NearbyPlaceData | null => {
      const placeId = place.id;
      const placeLocation = normalizePlaceLocation(place.location);
      if (!placeId || !placeLocation) return null;
      if (!isFoodPlace(place.primaryType, place.types)) return null;
      if (
        !isSameGenrePlace(
          place.primaryType,
          place.types,
          place.displayName?.text,
          place.primaryTypeDisplayName?.text,
          genreFilter,
        )
      ) {
        return null;
      }

      return {
        placeId,
        name: place.displayName?.text || '名称不明',
        genre: place.primaryTypeDisplayName?.text || '飲食店',
        primaryType: place.primaryType,
        types: normalizeTypes(place.types, place.primaryType),
        categories: normalizeCategories(place.primaryTypeDisplayName?.text, place.primaryType, place.types),
        address: place.formattedAddress || '住所不明',
        googleRating: clampNumber(toFiniteNumber(place.rating) ?? 0, 0, 5),
        userRatingCount: Math.max(0, Math.round(toFiniteNumber(place.userRatingCount) ?? 0)),
        ...(normalizePriceLevel(place.priceLevel) ? { priceLevel: normalizePriceLevel(place.priceLevel) } : {}),
        ...(normalizePriceRange(place.priceRange) ? { priceRange: normalizePriceRange(place.priceRange) } : {}),
        location: placeLocation,
        distanceMeters: Math.round(computeDistanceMeters(location, placeLocation)),
      };
    })
    .filter((place): place is NearbyPlaceData => place !== null)
    .slice(0, maxResultCount);
}

export async function fetchPlaceDetailsById(
  placeId: string,
  fallback: NearbyPlaceData,
  env: Env,
  reviewSampleLimit: number,
): Promise<PlaceData> {
  const detailsUrl = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  detailsUrl.searchParams.set('languageCode', 'ja');

  let detailsResult: { response: Response; json: PlacesDetailsResponse | null };
  try {
    detailsResult = await fetchJsonWithTimeout<PlacesDetailsResponse>(
      detailsUrl.toString(),
      {
        headers: {
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask':
            'id,displayName,primaryType,primaryTypeDisplayName,types,formattedAddress,rating,userRatingCount,priceLevel,priceRange,reviews,location',
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
    placeId: detailsJson.id || placeId,
    name: detailsJson.displayName?.text || fallback.name,
    address: detailsJson.formattedAddress || fallback.address,
    genre: detailsJson.primaryTypeDisplayName?.text || fallback.genre,
    primaryType: detailsJson.primaryType || fallback.primaryType,
    types: normalizeTypes(detailsJson.types || fallback.types, detailsJson.primaryType || fallback.primaryType),
    categories: normalizeCategories(
      detailsJson.primaryTypeDisplayName?.text || fallback.genre,
      detailsJson.primaryType || fallback.primaryType,
      detailsJson.types || fallback.types,
    ),
    googleRating: clampNumber(toFiniteNumber(detailsJson.rating) ?? fallback.googleRating, 0, 5),
    userRatingCount: Math.max(0, Math.round(toFiniteNumber(detailsJson.userRatingCount) ?? fallback.userRatingCount)),
    ...(normalizePriceLevel(detailsJson.priceLevel) || fallback.priceLevel
      ? { priceLevel: normalizePriceLevel(detailsJson.priceLevel) || fallback.priceLevel }
      : {}),
    ...(normalizePriceRange(detailsJson.priceRange) || fallback.priceRange
      ? { priceRange: normalizePriceRange(detailsJson.priceRange) || fallback.priceRange }
      : {}),
    reviews,
    location: normalizePlaceLocation(detailsJson.location) || fallback.location,
  };
}

export function buildNearbyGenreFilter(
  originGenre?: string,
  originCategories: string[] = [],
  originPlaceName?: string,
): NearbyGenreFilter {
  const terms = [originGenre, originPlaceName, ...originCategories]
    .map(normalizeGenreTerm)
    .filter((term): term is string => Boolean(term));
  const requestedTerms = Array.from(new Set(terms));
  const directTypes = originCategories
    .map((category) => normalizePlaceType(category))
    .filter((type): type is string => type !== null && FOOD_PLACE_TYPES.has(type));
  const specificDirectTypes = directTypes.filter((type) => !BROAD_FOOD_PLACE_TYPES.has(type));

  if (specificDirectTypes.length > 0) {
    const includedPrimaryTypes = uniqueTypes(specificDirectTypes);
    const definition = findGenreDefinitionForTypes(includedPrimaryTypes);
    return {
      label: originGenre || definition?.label || originCategories[0] || '同ジャンル',
      includedPrimaryTypes,
      requestedTerms,
      isFallback: false,
      strictMatchTerms: normalizeGenreTerms(definition?.keywords || requestedTerms),
    };
  }

  for (const definition of GENRE_DEFINITIONS) {
    if (
      requestedTerms.some((term) => definition.keywords.some((keyword) => term.includes(normalizeGenreTerm(keyword))))
    ) {
      return {
        label: definition.label,
        includedPrimaryTypes: definition.primaryTypes,
        requestedTerms,
        isFallback: false,
        strictMatchTerms: normalizeGenreTerms(definition.keywords),
      };
    }
  }

  return {
    label: originGenre || '飲食店',
    includedPrimaryTypes: ['restaurant'],
    requestedTerms,
    isFallback: true,
    strictMatchTerms: requestedTerms,
  };
}

const FOOD_PLACE_TYPES = new Set([
  'restaurant',
  'afghani_restaurant',
  'african_restaurant',
  'asian_restaurant',
  'bagel_shop',
  'bakery',
  'bar',
  'bar_and_grill',
  'barbecue_restaurant',
  'brazilian_restaurant',
  'breakfast_restaurant',
  'brunch_restaurant',
  'buffet_restaurant',
  'cafe',
  'cafeteria',
  'chicken_restaurant',
  'chicken_wings_restaurant',
  'chinese_noodle_restaurant',
  'coffee_shop',
  'deli',
  'dessert_restaurant',
  'dessert_shop',
  'diner',
  'donut_shop',
  'family_restaurant',
  'fast_food_restaurant',
  'fine_dining_restaurant',
  'food_court',
  'greek_restaurant',
  'hamburger_restaurant',
  'ice_cream_shop',
  'indonesian_restaurant',
  'japanese_curry_restaurant',
  'japanese_restaurant',
  'japanese_izakaya_restaurant',
  'juice_shop',
  'korean_barbecue_restaurant',
  'mediterranean_restaurant',
  'middle_eastern_restaurant',
  'sandwich_shop',
  'steak_house',
  'tea_house',
  'tonkatsu_restaurant',
  'turkish_restaurant',
  'vegan_restaurant',
  'vegetarian_restaurant',
  'wine_bar',
  'winery',
  'yakitori_restaurant',
  'ramen_restaurant',
  'sushi_restaurant',
  'seafood_restaurant',
  'yakiniku_restaurant',
  'chinese_restaurant',
  'korean_restaurant',
  'thai_restaurant',
  'vietnamese_restaurant',
  'indian_restaurant',
  'italian_restaurant',
  'french_restaurant',
  'mexican_restaurant',
  'spanish_restaurant',
  'american_restaurant',
  'barbecue_restaurant',
  'hamburger_restaurant',
  'pizza_restaurant',
  'pub',
  'izakaya_restaurant',
]);

const BROAD_FOOD_PLACE_TYPES = new Set(['restaurant', 'japanese_restaurant']);

const NEARBY_RESTAURANT_PRIMARY_TYPES = [
  'restaurant',
  'japanese_restaurant',
  'japanese_izakaya_restaurant',
  'tea_house',
  'ramen_restaurant',
  'sushi_restaurant',
  'seafood_restaurant',
  'yakiniku_restaurant',
  'korean_barbecue_restaurant',
  'yakitori_restaurant',
  'tonkatsu_restaurant',
  'japanese_curry_restaurant',
  'chicken_restaurant',
  'chinese_noodle_restaurant',
  'chinese_restaurant',
  'korean_restaurant',
  'thai_restaurant',
  'vietnamese_restaurant',
  'indian_restaurant',
  'italian_restaurant',
  'french_restaurant',
  'spanish_restaurant',
  'american_restaurant',
  'barbecue_restaurant',
  'hamburger_restaurant',
  'pizza_restaurant',
  'fast_food_restaurant',
  'cafe',
  'coffee_shop',
  'bakery',
  'bar',
  'pub',
  'wine_bar',
  'dessert_restaurant',
  'dessert_shop',
] as const;

const GENRE_DEFINITIONS: Array<{ label: string; keywords: string[]; primaryTypes: string[] }> = [
  { label: '居酒屋', keywords: ['居酒屋', 'izakaya'], primaryTypes: ['japanese_izakaya_restaurant'] },
  { label: 'ラーメン', keywords: ['ラーメン', 'らーめん', 'ramen'], primaryTypes: ['ramen_restaurant'] },
  {
    label: 'カフェ',
    keywords: ['カフェ', '喫茶', 'コーヒー', 'cafe', 'coffee'],
    primaryTypes: ['cafe', 'coffee_shop', 'tea_house'],
  },
  { label: '寿司', keywords: ['寿司', '鮨', 'すし', 'sushi'], primaryTypes: ['sushi_restaurant'] },
  {
    label: '焼肉',
    keywords: ['焼肉', 'yakiniku'],
    primaryTypes: ['yakiniku_restaurant', 'korean_barbecue_restaurant'],
  },
  { label: '焼き鳥', keywords: ['焼鳥', '焼き鳥', 'yakitori'], primaryTypes: ['yakitori_restaurant'] },
  { label: 'とんかつ', keywords: ['とんかつ', 'トンカツ', 'tonkatsu'], primaryTypes: ['tonkatsu_restaurant'] },
  { label: 'カレー', keywords: ['カレー', 'curry'], primaryTypes: ['japanese_curry_restaurant', 'indian_restaurant'] },
  {
    label: '中華',
    keywords: ['中華', '中国料理', 'chinese'],
    primaryTypes: ['chinese_restaurant', 'chinese_noodle_restaurant'],
  },
  {
    label: '韓国料理',
    keywords: ['韓国', 'korean'],
    primaryTypes: ['korean_restaurant', 'korean_barbecue_restaurant'],
  },
  {
    label: 'イタリアン',
    keywords: ['イタリアン', 'italian'],
    primaryTypes: ['italian_restaurant', 'pizza_restaurant'],
  },
  { label: 'フレンチ', keywords: ['フレンチ', 'french'], primaryTypes: ['french_restaurant'] },
  { label: 'タイ料理', keywords: ['タイ料理', 'thai'], primaryTypes: ['thai_restaurant'] },
  { label: 'ベトナム料理', keywords: ['ベトナム', 'vietnamese'], primaryTypes: ['vietnamese_restaurant'] },
  { label: 'インド料理', keywords: ['インド', 'indian'], primaryTypes: ['indian_restaurant'] },
  { label: 'ハンバーガー', keywords: ['ハンバーガー', 'hamburger', 'burger'], primaryTypes: ['hamburger_restaurant'] },
  { label: 'ピザ', keywords: ['ピザ', 'pizza'], primaryTypes: ['pizza_restaurant'] },
  { label: 'バー', keywords: ['バー', 'bar', 'pub'], primaryTypes: ['bar', 'pub', 'wine_bar'] },
  { label: 'ベーカリー', keywords: ['パン', 'ベーカリー', 'bakery'], primaryTypes: ['bakery'] },
  {
    label: 'スイーツ',
    keywords: ['スイーツ', 'デザート', 'dessert'],
    primaryTypes: ['dessert_restaurant', 'dessert_shop'],
  },
  { label: 'ファストフード', keywords: ['ファストフード', 'fast food'], primaryTypes: ['fast_food_restaurant'] },
  { label: '和食', keywords: ['和食', '日本料理', 'japanese'], primaryTypes: ['japanese_restaurant'] },
];

function isFoodPlace(primaryType: string | undefined, types: string[] | undefined): boolean {
  if (primaryType) return FOOD_PLACE_TYPES.has(primaryType);
  return (types || []).some((type) => FOOD_PLACE_TYPES.has(type));
}

function isSameGenrePlace(
  primaryType: string | undefined,
  types: string[] | undefined,
  name: string | undefined,
  primaryTypeDisplayName: string | undefined,
  genreFilter: NearbyGenreFilter,
): boolean {
  if (genreFilter.isFallback) return true;
  const placeTypes = normalizeTypes(types, primaryType);
  if (placeTypes.some((type) => genreFilter.includedPrimaryTypes.includes(type))) return true;
  const labelText = normalizeGenreTerm([name, primaryTypeDisplayName, ...(types || [])].filter(Boolean).join(' '));
  return genreFilter.strictMatchTerms.some((term) => labelText.includes(term));
}

function clampNearbyResultCount(maxResultCount: number): number {
  return Math.max(1, Math.min(20, Math.round(maxResultCount)));
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

function normalizeTypes(types: string[] | undefined, primaryType?: string): string[] {
  return uniqueTypes([primaryType, ...(types || [])].filter((type): type is string => Boolean(type)));
}

function normalizeCategories(primaryTypeDisplayName?: string, primaryType?: string, types?: string[]): string[] {
  const categories = [primaryTypeDisplayName, primaryType, ...(types || [])]
    .map((category) => category?.trim())
    .filter((category): category is string => Boolean(category));
  return Array.from(new Set(categories)).slice(0, 8);
}

function normalizePriceLevel(value: string | undefined): PlacePriceLevel | undefined {
  if (!value) return undefined;
  const priceLevels = new Set<PlacePriceLevel>([
    'PRICE_LEVEL_UNSPECIFIED',
    'PRICE_LEVEL_FREE',
    'PRICE_LEVEL_INEXPENSIVE',
    'PRICE_LEVEL_MODERATE',
    'PRICE_LEVEL_EXPENSIVE',
    'PRICE_LEVEL_VERY_EXPENSIVE',
  ]);
  return priceLevels.has(value as PlacePriceLevel) ? (value as PlacePriceLevel) : undefined;
}

function normalizePriceRange(value: unknown): PlacePriceRange | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const startPrice = normalizeMoney(record.startPrice);
  const endPrice = normalizeMoney(record.endPrice);
  if (!startPrice && !endPrice) return undefined;
  return {
    ...(startPrice ? { startPrice } : {}),
    ...(endPrice ? { endPrice } : {}),
  };
}

function normalizeMoney(value: unknown): PlacePriceRange['startPrice'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const currencyCode = typeof record.currencyCode === 'string' ? record.currencyCode : undefined;
  const units = typeof record.units === 'string' ? record.units : undefined;
  const nanos = toFiniteNumber(record.nanos);
  if (!currencyCode && !units && nanos === null) return undefined;
  return {
    ...(currencyCode ? { currencyCode } : {}),
    ...(units ? { units } : {}),
    ...(nanos !== null ? { nanos: Math.round(nanos) } : {}),
  };
}

function normalizeGenreTerm(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[\s\u3000・ー-]+/g, '')
    .trim();
}

function normalizeGenreTerms(values: string[]): string[] {
  return values.map(normalizeGenreTerm).filter((term) => term.length > 0);
}

function normalizePlaceType(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!/^[a-z0-9_]+$/.test(normalized)) return null;
  return normalized;
}

function uniqueTypes(types: string[]): string[] {
  const validTypes = types.filter((type) =>
    NEARBY_RESTAURANT_PRIMARY_TYPES.includes(type as (typeof NEARBY_RESTAURANT_PRIMARY_TYPES)[number]),
  );
  return Array.from(new Set(validTypes.length > 0 ? validTypes : ['restaurant'])).slice(0, 20);
}

function findGenreDefinitionForTypes(
  types: string[],
): { label: string; keywords: string[]; primaryTypes: string[] } | undefined {
  return GENRE_DEFINITIONS.find((definition) => types.some((type) => definition.primaryTypes.includes(type)));
}

function computeDistanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const earthRadiusMeters = 6371000;
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
