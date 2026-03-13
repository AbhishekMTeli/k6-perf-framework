/**
 * Load Test — Steady-state traffic simulation.
 *
 * Uses constant-arrival-rate executor (open workload model):
 *   - Arrivals are independent of response time.
 *   - If the system slows down, VUs queue up and error rate rises — real behavior.
 *   - JMeter's thread model hides this: slow responses = fewer requests, masking the problem.
 *
 * Stages:
 *   1. Warm-up   (2 min)  — ramp to target rate, results discarded
 *   2. Sustained (10 min) — production-level load, results measured
 *   3. Cool-down (1 min)  — graceful drain
 *
 * Override defaults via env vars:
 *   LOAD_RATE       requests/second (default: 50)
 *   LOAD_DURATION   sustained duration in seconds (default: 600)
 */

import { sleep } from 'k6';
import { getEnvConfig } from '../config/environments.js';
import { getThresholds } from '../config/thresholds.js';
import { login } from '../flows/auth.js';
import { fullCrudJourney, listItems, getItem } from '../flows/items.js';

const envConfig = getEnvConfig();
const rate = parseInt(__ENV.LOAD_RATE || '50');
const duration = parseInt(__ENV.LOAD_DURATION || '600');

export const options = {
  scenarios: {
    // Read-heavy load — 80% of traffic
    read_load: {
      executor: 'constant-arrival-rate',
      rate: Math.floor(rate * 0.8),
      timeUnit: '1s',
      duration: `${duration}s`,
      preAllocatedVUs: Math.floor(rate * 0.8 * 2),
      maxVUs: Math.floor(rate * 0.8 * 10),
      startTime: '2m', // after warm-up
      tags: { workload: 'read' },
    },

    // Write load — 20% of traffic
    write_load: {
      executor: 'constant-arrival-rate',
      rate: Math.floor(rate * 0.2),
      timeUnit: '1s',
      duration: `${duration}s`,
      preAllocatedVUs: Math.floor(rate * 0.2 * 2),
      maxVUs: Math.floor(rate * 0.2 * 10),
      startTime: '2m',
      tags: { workload: 'write' },
    },

    // Warm-up — ramp from 10% to 100% of target rate
    warm_up: {
      executor: 'ramping-arrival-rate',
      stages: [
        { target: Math.floor(rate * 0.1), duration: '30s' },
        { target: rate, duration: '90s' },
      ],
      preAllocatedVUs: rate,
      maxVUs: rate * 5,
      startTime: '0s',
      tags: { workload: 'warmup' },
    },
  },

  thresholds: getThresholds(envConfig.env),
};

// VU-level token cache — login once per VU, reuse across iterations
let token = null;

export default function () {
  if (!token) {
    token = login(envConfig.baseUrl, envConfig.credentials);
  }

  const scenario = __ENV.K6_SCENARIO_NAME || 'read_load';

  if (scenario === 'write_load') {
    fullCrudJourney(envConfig.baseUrl, token);
    sleep(0.5);
  } else {
    const { itemId } = listItems(envConfig.baseUrl, token);
    getItem(envConfig.baseUrl, token, itemId);
    sleep(0.2);
  }
}
