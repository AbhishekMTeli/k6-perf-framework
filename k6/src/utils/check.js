/**
 * Assertion helpers.
 *
 * k6's built-in `check()` returns false on failure but never throws —
 * failures are recorded as metrics and the test keeps running.
 *
 * These wrappers:
 *   1. Combine multiple checks per response in one call
 *   2. Log structured failure context (status, body, URL) for debugging
 *   3. Track a custom 'checks_failed' counter metric for threshold targeting
 *   4. Support optional hard-fail (throws) for setup/teardown phases
 */

import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// Custom metrics
export const checksFailedCount = new Counter('checks_failed_total');
export const checkFailRate = new Rate('check_fail_rate');

/**
 * Assert a response meets expectations.
 *
 * @param {Response} res - k6 HTTP response
 * @param {object} expectations - map of label → function(res) → boolean
 * @param {object} opts
 * @param {boolean} opts.hardFail - throw on first failure (use in setup/teardown)
 * @param {string} opts.context - extra context logged on failure
 *
 * @example
 * assertResponse(res, {
 *   'status is 200': r => r.status === 200,
 *   'has token': r => r.json('token') !== undefined,
 * });
 */
export function assertResponse(res, expectations, opts = {}) {
  const passed = check(res, expectations);

  if (!passed) {
    checksFailedCount.add(1);
    checkFailRate.add(1);

    const failures = Object.entries(expectations)
      .filter(([, fn]) => !fn(res))
      .map(([label]) => label);

    const logLine = JSON.stringify({
      level: 'error',
      url: res.url,
      status: res.status,
      failed_checks: failures,
      context: opts.context || '',
      body_preview: res.body ? String(res.body).slice(0, 200) : null,
    });

    console.error(logLine);

    if (opts.hardFail) {
      throw new Error(`Hard assertion failed on ${res.url}: ${failures.join(', ')}`);
    }
  } else {
    checkFailRate.add(0);
  }

  return passed;
}

/**
 * Common expectation sets — reuse across scenarios.
 */
export const expect = {
  status: (code) => ({ [`status is ${code}`]: (r) => r.status === code }),

  statusIn: (...codes) => ({
    [`status in [${codes.join(',')}]`]: (r) => codes.includes(r.status),
  }),

  jsonField: (path) => ({
    [`json field '${path}' exists`]: (r) => {
      try {
        const val = r.json(path);
        return val !== undefined && val !== null;
      } catch {
        return false;
      }
    },
  }),

  responseTime: (maxMs) => ({
    [`response time < ${maxMs}ms`]: (r) => r.timings.duration < maxMs,
  }),

  bodyContains: (text) => ({
    [`body contains '${text}'`]: (r) => r.body && r.body.includes(text),
  }),

  // Combine multiple expectation objects into one
  all: (...expectationObjects) =>
    Object.assign({}, ...expectationObjects),
};
