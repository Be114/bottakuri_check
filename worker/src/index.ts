import { handleAnalyze } from './handlers/analyze';
import { handleHealth } from './handlers/health';
import { Env } from './types';
import {
  ApiHttpError,
  buildErrorResponse,
  buildJsonResponse,
  buildPreflightResponse,
  resolveAllowedOrigin,
} from './utils/response';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowedOrigin = resolveAllowedOrigin(origin, env.ALLOWED_ORIGINS);

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') {
        return buildErrorResponse('UPSTREAM_ERROR', 405, 'Method Not Allowed', allowedOrigin);
      }
      return handleHealth(env, allowedOrigin);
    }

    if (url.pathname !== '/api/analyze') {
      return buildErrorResponse('UPSTREAM_ERROR', 404, 'Not Found', allowedOrigin);
    }

    if (request.method === 'OPTIONS') {
      return buildPreflightResponse(allowedOrigin);
    }

    if (request.method !== 'POST') {
      return buildErrorResponse('UPSTREAM_ERROR', 405, 'Method Not Allowed', allowedOrigin);
    }

    if (!allowedOrigin) {
      return buildErrorResponse('UPSTREAM_ERROR', 403, '許可されていないOriginです。', null);
    }

    try {
      const result = await handleAnalyze(request, env);
      return buildJsonResponse(result, 200, allowedOrigin);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        return buildErrorResponse(error.code, error.status, error.message, allowedOrigin);
      }
      return buildErrorResponse('UPSTREAM_ERROR', 500, '予期せぬエラーが発生しました。', allowedOrigin);
    }
  },
};
