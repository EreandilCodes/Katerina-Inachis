/**
 * logger.js — Universal structured logging module
 *
 * Features:
 *  - Zero runtime dependencies (Node.js built-ins only)
 *  - AsyncLocalStorage for automatic request_id propagation
 *  - DEV: colored, human-readable output
 *  - PROD: structured JSON output
 *  - Secret field scrubbing
 *  - Standard log levels: debug / info / warn / error / fatal
 *
 * Configuration (env vars):
 *  LOG_LEVEL   — debug | info | warn | error | fatal  (default: debug in dev, info in prod)
 *  SERVICE_NAME — name of this service (default: "app")
 *  NODE_ENV    — development | production | test
 *
 * Usage:
 *  import { logger } from './logger.js';
 *  logger.info('user_login', { user_id: 42 });
 *  logger.error('upload_failed', { entity_type: 'image', error_type: err.name });
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

// ─── Request context ──────────────────────────────────────────────────────────
// Stores { requestId, userId } for the current async context (request lifecycle)
export const requestContext = new AsyncLocalStorage();

// ─── Config ───────────────────────────────────────────────────────────────────
const ENV         = process.env.NODE_ENV    || 'development';
const SERVICE     = process.env.SERVICE_NAME || 'app';
const IS_DEV      = ENV !== 'production' && ENV !== 'test';
const IS_TEST     = ENV === 'test';

const LEVEL_NUMS  = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
const DEFAULT_LEVEL = IS_DEV ? 'debug' : IS_TEST ? 'error' : 'info';
const LOG_LEVEL   = (process.env.LOG_LEVEL || DEFAULT_LEVEL).toLowerCase();
const MIN_LEVEL   = LEVEL_NUMS[LOG_LEVEL] ?? LEVEL_NUMS.info;

// ─── Secret scrubbing ─────────────────────────────────────────────────────────
// These field names are always redacted from logs regardless of mode
const SECRET_KEYS = new Set([
  'password', 'password_hash', 'passwordHash', 'password_confirm',
  'token', 'accessToken', 'refreshToken', 'access_token', 'refresh_token',
  'secret', 'jwt', 'apiKey', 'api_key',
  'authorization', 'cookie', 'cookies', 'session',
  'credit_card', 'creditCard', 'card_number', 'cardNumber', 'cvv', 'cvc',
  'ssn', 'pin',
  'smsCode', 'sms_code', 'verificationCode', 'verification_code', 'otp',
  'private_key', 'privateKey',
]);

function scrub(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => scrub(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k) || SECRET_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = scrub(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Dev formatting (colored, human-readable) ─────────────────────────────────
const C = {
  debug: '\x1b[36m',   // cyan
  info:  '\x1b[32m',   // green
  warn:  '\x1b[33m',   // yellow
  error: '\x1b[31m',   // red
  fatal: '\x1b[35m',   // magenta
  dim:   '\x1b[2m',
  bold:  '\x1b[1m',
  reset: '\x1b[0m',
};

function devFormat(level, event, fields) {
  const color  = C[level] ?? C.reset;
  const ts     = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const ctx    = requestContext.getStore();
  const reqId  = ctx?.requestId ? `${C.dim}[${ctx.requestId.slice(0, 8)}]${C.reset}` : '';
  const label  = `${color}${C.bold}${level.toUpperCase().padEnd(5)}${C.reset}`;
  const evtStr = `${C.bold}${event}${C.reset}`;

  let extra = '';
  if (fields && Object.keys(fields).length) {
    // Format nicely: key=value pairs for simple values, JSON for nested
    const parts = Object.entries(fields).map(([k, v]) => {
      if (v === null || v === undefined) return null;
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${C.dim}${k}=${C.reset}${val}`;
    }).filter(Boolean);
    if (parts.length) extra = ' ' + parts.join(' ');
  }

  return `${C.dim}${ts}${C.reset} ${label} ${reqId} ${evtStr}${extra}`;
}

// ─── Prod formatting (JSON) ───────────────────────────────────────────────────
function prodFormat(level, event, fields) {
  const ctx = requestContext.getStore() ?? {};
  const entry = {
    timestamp:   new Date().toISOString(),
    level,
    service:     SERVICE,
    environment: ENV,
    event,
    request_id:  ctx.requestId  ?? undefined,
    user_id:     ctx.userId     ?? undefined,
    ...fields,
  };
  // Remove undefined values for cleaner JSON
  for (const k of Object.keys(entry)) {
    if (entry[k] === undefined) delete entry[k];
  }
  return JSON.stringify(entry);
}

// ─── Core emit ────────────────────────────────────────────────────────────────
function emit(level, event, rawFields = {}) {
  if ((LEVEL_NUMS[level] ?? 99) < MIN_LEVEL) return;

  // Scrub secrets
  const fields = scrub(rawFields);

  const line = IS_DEV
    ? devFormat(level, event, fields)
    : prodFormat(level, event, fields);

  if (level === 'error' || level === 'fatal') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const logger = {
  /** Low-detail messages, only visible in dev */
  debug: (event, fields)  => emit('debug', event, fields),

  /** Normal operational messages */
  info:  (event, fields)  => emit('info',  event, fields),

  /** Something unexpected but non-fatal */
  warn:  (event, fields)  => emit('warn',  event, fields),

  /** Operational error, request may have failed */
  error: (event, fields)  => emit('error', event, fields),

  /** Critical failure, service may be unstable */
  fatal: (event, fields)  => emit('fatal', event, fields),

  /**
   * Convenience: log an Error object.
   * Includes error_type, error_message, and stack_trace (dev only).
   *
   * logger.fromError('db_query_failed', err, { entity_type: 'product' })
   */
  fromError: (event, err, fields = {}) => {
    const errFields = {
      error_type:    err?.name    ?? 'UnknownError',
      error_message: err?.message ?? String(err),
      ...(IS_DEV && err?.stack ? { stack_trace: err.stack } : {}),
      ...fields,
    };
    emit('error', event, errFields);
  },
};

// ─── Request context helpers ──────────────────────────────────────────────────
/**
 * Start a new request context with a fresh request_id.
 * Wraps the callback in AsyncLocalStorage.run().
 * Call this from requestLogger middleware.
 */
export function runWithRequestContext(requestId, userId, fn) {
  return requestContext.run({ requestId: requestId ?? randomUUID(), userId }, fn);
}

/**
 * Set the userId on the current request context (after authentication).
 * Call this from auth middleware once the user is known.
 */
export function setRequestUserId(userId) {
  const store = requestContext.getStore();
  if (store) store.userId = userId;
}
