/**
 * SLO-tied thresholds per environment.
 *
 * Production SLOs (non-negotiable):
 *   - P95 < 500ms, P99 < 1000ms, error rate < 0.1%
 *
 * Staging SLOs (relaxed by ~2x — staging infra is smaller):
 *   - P95 < 1000ms, P99 < 2000ms, error rate < 1%
 *
 * Thresholds abort the test (abortOnFail: true) if breached early
 * so you don't waste a 30-min run that's already failing.
 *
 * delayAbortEval: '30s' — give the system 30s to warm up before
 * evaluating abort conditions.
 */

export const THRESHOLDS = {
  local: {
    http_req_duration: [
      { threshold: 'p(95)<2000', abortOnFail: false },
      { threshold: 'p(99)<4000', abortOnFail: false },
    ],
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: false }],
    http_reqs: ['rate>1'],
  },

  staging: {
    // Per-scenario thresholds via metric tags (e.g. {scenario:load})
    http_req_duration: [
      { threshold: 'p(95)<1000', abortOnFail: true, delayAbortEval: '30s' },
      { threshold: 'p(99)<2000', abortOnFail: true, delayAbortEval: '30s' },
      { threshold: 'med<300', abortOnFail: false },
    ],
    http_req_failed: [
      { threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' },
    ],
    http_reqs: ['rate>10'],
    // Per-endpoint thresholds using custom metrics
    'http_req_duration{endpoint:list_items}': [
      { threshold: 'p(95)<500', abortOnFail: false },
    ],
    'http_req_duration{endpoint:get_item}': [
      { threshold: 'p(95)<300', abortOnFail: false },
    ],
    'http_req_duration{endpoint:create_item}': [
      { threshold: 'p(95)<1000', abortOnFail: false },
    ],
    'http_req_duration{endpoint:login}': [
      { threshold: 'p(95)<500', abortOnFail: false },
    ],
    iteration_duration: ['p(95)<10000'],
  },

  production: {
    http_req_duration: [
      { threshold: 'p(95)<500', abortOnFail: true, delayAbortEval: '30s' },
      { threshold: 'p(99)<1000', abortOnFail: true, delayAbortEval: '30s' },
      { threshold: 'med<200', abortOnFail: false },
    ],
    http_req_failed: [
      { threshold: 'rate<0.001', abortOnFail: true, delayAbortEval: '30s' },
    ],
    http_reqs: ['rate>50'],
    'http_req_duration{endpoint:list_items}': [
      { threshold: 'p(95)<300', abortOnFail: false },
    ],
    'http_req_duration{endpoint:get_item}': [
      { threshold: 'p(95)<200', abortOnFail: false },
    ],
    'http_req_duration{endpoint:create_item}': [
      { threshold: 'p(95)<500', abortOnFail: false },
    ],
    'http_req_duration{endpoint:login}': [
      { threshold: 'p(95)<300', abortOnFail: false },
    ],
    iteration_duration: ['p(95)<5000'],
  },
};

export function getThresholds(env) {
  return THRESHOLDS[env] || THRESHOLDS['staging'];
}
