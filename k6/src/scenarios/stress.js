/**
 * Stress Test — Find the breaking point.
 *
 * Progressive ramp using ramping-arrival-rate:
 *   - Starts at 10% of max, steps up every 5 minutes.
 *   - abortOnFail thresholds terminate the run at the breaking point.
 *   - The run number of the last passing stage = capacity baseline.
 *
 * Interpretation:
 *   - Where does P95 breach SLO?         → latency ceiling
 *   - Where does error rate climb?        → capacity limit
 *   - Where does throughput flatten?      → saturation point (Little's Law)
 *
 * After this test you know:
 *   1. Your max sustainable RPS
 *   2. Where to set autoscale trigger thresholds
 *   3. Whether the system recovers after overload (check cool-down stage)
 */

import { sleep } from 'k6';
import { getEnvConfig } from '../config/environments.js';
import { getThresholds } from '../config/thresholds.js';
import { login } from '../flows/auth.js';
import { fullCrudJourney } from '../flows/items.js';

const envConfig = getEnvConfig();
const maxRate = parseInt(__ENV.STRESS_MAX_RATE || '500');

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: Math.floor(maxRate * 0.1),
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: maxRate * 3,
      stages: [
        // Ramp up through 6 steps to find the breaking point
        { target: Math.floor(maxRate * 0.1), duration: '2m' },  // 10%
        { target: Math.floor(maxRate * 0.2), duration: '3m' },  // 20%
        { target: Math.floor(maxRate * 0.35), duration: '3m' }, // 35%
        { target: Math.floor(maxRate * 0.5), duration: '3m' },  // 50%
        { target: Math.floor(maxRate * 0.7), duration: '3m' },  // 70%
        { target: Math.floor(maxRate * 0.85), duration: '3m' }, // 85%
        { target: maxRate, duration: '3m' },                    // 100%
        // Recovery — system should return to baseline
        { target: Math.floor(maxRate * 0.2), duration: '3m' },  // cool-down
        { target: Math.floor(maxRate * 0.2), duration: '2m' },  // hold — verify recovery
      ],
    },
  },

  // Stress test uses relaxed thresholds — the point is to breach them
  // and observe at which load level that happens.
  // abortOnFail is still set so we don't waste resources past total failure.
  thresholds: {
    http_req_failed: [
      { threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '2m' },
    ],
    http_req_duration: [
      { threshold: 'p(99)<30000', abortOnFail: true, delayAbortEval: '2m' },
    ],
  },
};

let token = null;

export default function () {
  if (!token) {
    token = login(envConfig.baseUrl, envConfig.credentials);
  }

  fullCrudJourney(envConfig.baseUrl, token);
  sleep(0.1);
}
