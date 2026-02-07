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

export async function buildCacheKey(
  query: string,
  location?: { lat: number; lng: number }
): Promise<string> {
  const roundedLocation = location
    ? `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`
    : 'none';
  return `cache:v1:${await hashString(`${query}|${roundedLocation}`)}`;
}

export async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
