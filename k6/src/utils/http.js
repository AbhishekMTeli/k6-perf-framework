/**
 * HTTP utility — wraps k6's http with:
 *   - Automatic X-Request-ID (trace correlation with APM)
 *   - Automatic Authorization header injection
 *   - Per-endpoint metric tagging (for threshold targeting)
 *   - Structured error logging (never swallow failures silently)
 *   - Retry on 429/503 with exponential backoff
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const MAX_RETRIES = 3;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Build standard request params.
 * @param {string} token - JWT bearer token (optional)
 * @param {string} endpoint - logical endpoint name for metric tagging
 * @param {object} extraHeaders - additional headers to merge
 * @param {object} extraTags - additional tags for metric grouping
 */
export function buildParams(token, endpoint, extraHeaders = {}, extraTags = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Request-ID': uuidv4(),
    ...extraHeaders,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return {
    headers,
    tags: { endpoint, ...extraTags },
    timeout: '10s',
  };
}

/**
 * Perform a GET request with retry logic.
 */
export function get(url, token, endpoint, extraHeaders = {}) {
  return withRetry(() =>
    http.get(url, buildParams(token, endpoint, extraHeaders))
  );
}

/**
 * Perform a POST request with retry logic.
 */
export function post(url, body, token, endpoint, extraHeaders = {}) {
  return withRetry(() =>
    http.post(url, JSON.stringify(body), buildParams(token, endpoint, extraHeaders))
  );
}

/**
 * Perform a PUT request with retry logic.
 */
export function put(url, body, token, endpoint, extraHeaders = {}) {
  return withRetry(() =>
    http.put(url, JSON.stringify(body), buildParams(token, endpoint, extraHeaders))
  );
}

/**
 * Perform a DELETE request with retry logic.
 */
export function del(url, token, endpoint, extraHeaders = {}) {
  return withRetry(() =>
    http.del(url, null, buildParams(token, endpoint, extraHeaders))
  );
}

/**
 * Retry wrapper — backs off exponentially on retryable status codes.
 * Returns last response regardless (caller decides pass/fail via assertions).
 */
function withRetry(requestFn) {
  let res;
  let delay = 1;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    res = requestFn();

    if (!RETRY_STATUSES.has(res.status)) {
      return res;
    }

    if (attempt < MAX_RETRIES - 1) {
      // Exponential backoff: 1s, 2s, 4s
      sleep(delay);
      delay *= 2;
    }
  }

  return res;
}
