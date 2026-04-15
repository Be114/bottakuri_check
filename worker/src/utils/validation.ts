import { DEFAULT_REVIEW_SAMPLE_LIMIT, MAX_REVIEW_SAMPLE_LIMIT, MIN_REVIEW_SAMPLE_LIMIT } from '../constants';
import { AnalyzeRequest } from '../types';

export function sanitizeQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') return '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional sanitization for control characters
  return rawQuery.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sanitizeLocation(
  rawLocation: AnalyzeRequest['location']
): { lat: number; lng: number } | undefined {
  if (!rawLocation || typeof rawLocation !== 'object') return undefined;
  const lat = toFiniteNumber(rawLocation.lat);
  const lng = toFiniteNumber(rawLocation.lng);
  if (lat === null || lng === null) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

export function toPositiveInt(rawValue: string | null | undefined, fallback: number): number {
  // Returns a non-negative integer (0 is valid).
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function toBoundedInt(rawValue: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumber(Math.floor(parsed), min, max);
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveReviewSampleLimit(rawValue: string | undefined): number {
  return toBoundedInt(rawValue, DEFAULT_REVIEW_SAMPLE_LIMIT, MIN_REVIEW_SAMPLE_LIMIT, MAX_REVIEW_SAMPLE_LIMIT);
}
