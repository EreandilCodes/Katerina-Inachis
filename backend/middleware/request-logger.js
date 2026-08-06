/**
 * request-logger.js — Express middleware for per-request logging
 *
 * - Generates a unique request_id (UUID v4) for every request
 * - Wraps the request in AsyncLocalStorage context so all logs
 *   within the request automatically include the request_id
 * - Sets X-Request-Id response header for client correlation
 * - Logs request_start (debug) and request_end (info/warn/error)
 * - Attaches req.requestId for use in route handlers
 */

import { randomUUID } from 'crypto';
import { logger, runWithRequestContext } from '../logger.js';

// Paths that produce a lot of noise — skip request_start/end for these
const SILENT_PATHS = new Set(['/health', '/favicon.ico', '/robots.txt']);

export function requestLogger(req, res, next) {
  const requestId = randomUUID();
  const startTime = process.hrtime.bigint();

  // Expose on req for manual use in routes
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  runWithRequestContext(requestId, undefined, () => {
    if (!SILENT_PATHS.has(req.path)) {
      logger.debug('request_start', {
        method: req.method,
        path:   req.path,
        ip:     req.ip ?? req.socket?.remoteAddress,
      });
    }

    res.on('finish', () => {
      if (SILENT_PATHS.has(req.path)) return;

      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      const status     = res.statusCode;
      const level      = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

      logger[level]('request_end', {
        method:      req.method,
        path:        req.path,
        status,
        duration_ms: Math.round(durationMs),
      });
    });

    next();
  });
}
