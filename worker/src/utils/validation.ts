import { DEFAULT_REVIEW_SAMPLE_LIMIT, MAX_REVIEW_SAMPLE_LIMIT, MIN_REVIEW_SAMPLE_LIMIT } from '../constants';
import { AnalyzeRequest } from '../types';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

export function sanitizeQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') return '';
  return rawQuery.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

export function sanitizeLocation(rawLocation: AnalyzeRequest['location']): { lat: number; lng: number } | undefined {
  if (!rawLocation || typeof rawLocation !== 'object') return undefined;
  const lat = toFiniteNumber(rawLocation.lat);
  const lng = toFiniteNumber(rawLocation.lng);
  if (lat === null || lng === null) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

export function toNonNegativeInt(rawValue: string | null | undefined, fallback: number): number {
  // Returns a non-negative integer (0 is valid).
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function toIntegerInRange(
  rawValue: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
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
  return toIntegerInRange(rawValue, DEFAULT_REVIEW_SAMPLE_LIMIT, MIN_REVIEW_SAMPLE_LIMIT, MAX_REVIEW_SAMPLE_LIMIT);
}
