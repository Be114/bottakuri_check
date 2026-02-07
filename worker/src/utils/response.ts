import { ErrorCode } from '../types';

export class ApiHttpError extends Error {
  code: ErrorCode;
  status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function buildPreflightResponse(allowedOrigin: string | null): Response {
  if (!allowedOrigin) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(allowedOrigin),
  });
}

export function buildErrorResponse(code: ErrorCode, status: number, message: string, allowedOrigin: string | null): Response {
  return buildJsonResponse({ error: { code, message } }, status, allowedOrigin);
}

export function buildJsonResponse(body: unknown, status: number, allowedOrigin: string | null): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  if (allowedOrigin) {
    const corsHeaders = buildCorsHeaders(allowedOrigin);
    corsHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return new Response(JSON.stringify(body), { status, headers });
}

export function buildCorsHeaders(origin: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
}

export function resolveAllowedOrigin(origin: string | null, allowedOriginsRaw: string | undefined): string | null {
  if (!origin) return null;
  const allowedOrigins = (allowedOriginsRaw || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (allowedOrigins.includes('*')) return origin;
  if (allowedOrigins.includes(origin)) return origin;
  return null;
}
