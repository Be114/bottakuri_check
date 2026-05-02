import { handleAnalyze } from './handlers/analyze';
import { handleHealth } from './handlers/health';
import { handleNearbyMap } from './handlers/nearbyMap';
import { handleNearbyRankings } from './handlers/nearbyRankings';
export { AtomicCounter } from './durableObjects/atomicCounter';
import { incrementMetric, metricKey } from './services/kvStore';
import { Env } from './types';
import {
  ApiHttpError,
  buildErrorResponse,
  buildJsonResponse,
  buildPreflightResponse,
  resolveAllowedOrigin,
} from './utils/response';
import { formatDayInTimeZone, resolveDayRolloverTimezone } from './utils/time';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowedOrigin = resolveAllowedOrigin(origin, env.ALLOWED_ORIGINS);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/health') {
      if (method !== 'GET') {
        return await finalizeErrorResponse({
          env,
          requestId,
          path,
          method,
          origin,
          allowedOrigin,
          startedAt,
          code: 'UPSTREAM_ERROR',
          status: 405,
          message: 'Method Not Allowed',
        });
      }

      const response = await handleHealth(env, allowedOrigin, requestId);
      logResponse({
        requestId,
        path,
        method,
        status: response.status,
        latencyMs: Date.now() - startedAt,
      });
      return response;
    }

    if (path === '/api/nearby-map') {
      if (method === 'OPTIONS') {
        const response = buildPreflightResponse(allowedOrigin);
        logResponse({
          requestId,
          path,
          method,
          status: response.status,
          latencyMs: Date.now() - startedAt,
        });
        return response;
      }

      if (method !== 'GET') {
        return await finalizeErrorResponse({
          env,
          requestId,
          path,
          method,
          origin,
          allowedOrigin,
          startedAt,
          code: 'UPSTREAM_ERROR',
          status: 405,
          message: 'Method Not Allowed',
        });
      }

      try {
        const response = await handleNearbyMap(request, env, allowedOrigin, requestId);
        logResponse({
          requestId,
          path,
          method,
          status: response.status,
          latencyMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        if (error instanceof ApiHttpError) {
          return await finalizeErrorResponse({
            env,
            requestId,
            path,
            method,
            origin,
            allowedOrigin,
            startedAt,
            code: error.code,
            status: error.status,
            message: error.message,
          });
        }
        return await finalizeErrorResponse({
          env,
          requestId,
          path,
          method,
          origin,
          allowedOrigin,
          startedAt,
          code: 'UPSTREAM_ERROR',
          status: 500,
          message: '予期せぬエラーが発生しました。',
        });
      }
    }

    const postHandlers = new Map<string, (request: Request, env: Env) => Promise<unknown>>([
      ['/api/analyze', handleAnalyze],
      ['/api/nearby-rankings', handleNearbyRankings],
    ]);

    const handler = postHandlers.get(path);
    if (!handler) {
      return await finalizeErrorResponse({
        env,
        requestId,
        path,
        method,
        origin,
        allowedOrigin,
        startedAt,
        code: 'UPSTREAM_ERROR',
        status: 404,
        message: 'Not Found',
      });
    }

    if (method === 'OPTIONS') {
      const response = buildPreflightResponse(allowedOrigin);
      logResponse({
        requestId,
        path,
        method,
        status: response.status,
        latencyMs: Date.now() - startedAt,
      });
      return response;
    }

    if (method !== 'POST') {
      return await finalizeErrorResponse({
        env,
        requestId,
        path,
        method,
        origin,
        allowedOrigin,
        startedAt,
        code: 'UPSTREAM_ERROR',
        status: 405,
        message: 'Method Not Allowed',
      });
    }

    if (!allowedOrigin) {
      return await finalizeErrorResponse({
        env,
        requestId,
        path,
        method,
        origin,
        allowedOrigin: null,
        startedAt,
        code: 'UPSTREAM_ERROR',
        status: 403,
        message: '許可されていないOriginです。',
      });
    }

    try {
      const result = await handler(request, env);
      const response = buildJsonResponse(result, 200, allowedOrigin, requestId);
      logResponse({
        requestId,
        path,
        method,
        status: response.status,
        latencyMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      if (error instanceof ApiHttpError) {
        return await finalizeErrorResponse({
          env,
          requestId,
          path,
          method,
          origin,
          allowedOrigin,
          startedAt,
          code: error.code,
          status: error.status,
          message: error.message,
        });
      }
      return await finalizeErrorResponse({
        env,
        requestId,
        path,
        method,
        origin,
        allowedOrigin,
        startedAt,
        code: 'UPSTREAM_ERROR',
        status: 500,
        message: '予期せぬエラーが発生しました。',
      });
    }
  },
};

async function finalizeErrorResponse(params: {
  env: Env;
  requestId: string;
  path: string;
  method: string;
  origin: string | null;
  allowedOrigin: string | null;
  startedAt: number;
  code: 'INVALID_QUERY' | 'RATE_LIMIT' | 'BUDGET_EXCEEDED' | 'MODEL_UNAVAILABLE' | 'UPSTREAM_ERROR';
  status: number;
  message: string;
}): Promise<Response> {
  await recordErrorMetric(params.env).catch(() => {
    // Metric failures should not affect API responses.
  });

  const response = buildErrorResponse(
    params.code,
    params.status,
    params.message,
    params.allowedOrigin,
    params.requestId,
  );

  logResponse({
    requestId: params.requestId,
    path: params.path,
    method: params.method,
    status: params.status,
    errorCode: params.code,
    latencyMs: Date.now() - params.startedAt,
    origin: params.origin,
    allowedOrigin: params.allowedOrigin,
  });

  return response;
}

async function recordErrorMetric(env: Env): Promise<void> {
  const day = formatDayInTimeZone(new Date(), resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE));
  await incrementMetric(env, metricKey('error_count', day));
}

function logResponse(params: {
  requestId: string;
  path: string;
  method: string;
  status: number;
  latencyMs: number;
  errorCode?: string;
  origin?: string | null;
  allowedOrigin?: string | null;
}): void {
  const payload = {
    level: params.status >= 500 ? 'error' : params.status >= 400 ? 'warn' : 'info',
    requestId: params.requestId,
    path: params.path,
    method: params.method,
    status: params.status,
    errorCode: params.errorCode || null,
    latencyMs: params.latencyMs,
    origin: params.origin ?? null,
    allowedOrigin: params.allowedOrigin ?? null,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
}
