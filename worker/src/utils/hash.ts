export function readClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;

  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';

  return 'unknown';
}

export async function hashIp(ip: string): Promise<string> {
  return hashString(ip);
}

export async function buildCacheKey(query: string, location?: { lat: number; lng: number }): Promise<string> {
  const normalizedQuery = query.toLowerCase();
  const roundedLocation = location ? `${location.lat.toFixed(2)},${location.lng.toFixed(2)}` : 'none';
  return `cache:v1:${await hashString(`${normalizedQuery}|${roundedLocation}`)}`;
}

export async function buildNearbyCacheKey(
  location: { lat: number; lng: number },
  radiusMeters: number,
  genreKey = 'restaurant',
): Promise<string> {
  const roundedLocation = `${location.lat.toFixed(3)},${location.lng.toFixed(3)}`;
  const normalizedGenreKey = normalizeNearbyGenreKey(genreKey);
  return `cache:nearby-rankings:v5:${await hashString(
    `${roundedLocation}|${Math.round(radiusMeters)}|${normalizedGenreKey}`,
  )}`;
}

export async function buildNearbyPlaceAnalysisCacheKey(placeId: string): Promise<string> {
  return `cache:nearby-place-analysis:v1:${await hashString(placeId)}`;
}

function normalizeNearbyGenreKey(genreKey: string): string {
  const normalizedTypes = genreKey
    .split(',')
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean)
    .sort();

  return Array.from(new Set(normalizedTypes)).join(',') || 'restaurant';
}

export async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
