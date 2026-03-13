/**
 * Soak Test — Endurance / memory leak detection.
 *
 * Runs at moderate load (60-70% of capacity) for an extended duration (2-8 hours).
 *
 * What it catches that load/stress tests miss:
 *   - Memory leaks        → latency slowly climbs over hours, not minutes
 *   - Connection pool exhaustion → errors appear after N requests, not immediately
 *   - Log rotation issues → disk fills after extended run
 *   - Cache TTL problems  → cache misses spike at regular intervals
 *   - Thread pool starvation → intermittent timeouts after sustained load
 *   - Database connection leaks → gradual error rate increase
 *
 * How to read results:
 *   - P95 slowly climbing over time = memory pressure
 *   - Sudden error spikes at intervals = cache TTL or cron job contention
 *   - Flat P95 throughout = clean soak pass
 *
 * Duration via SOAK_DURATION env var (seconds, default: 7200 = 2 hours).
 */

import { sleep } from 'k6';
import { getEnvConfig } from '../config/environments.js';
import { getThresholds } from '../config/thresholds.js';
import { login, refreshToken } from '../flows/auth.js';
import { listItems, getItem, createItem, deleteItem } from '../flows/items.js';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const envConfig = getEnvConfig();
const soakRate = parseInt(__ENV.SOAK_RATE || '30');
const soakDuration = parseInt(__ENV.SOAK_DURATION || '7200');

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      rate: soakRate,
      timeUnit: '1s',
      duration: `${soakDuration}s`,
      preAllocatedVUs: soakRate * 2,
      maxVUs: soakRate * 5,
    },
  },

  thresholds: {
    ...getThresholds(envConfig.env),
    // Soak-specific: P95 should not drift upward over time
    // Monitor this in Grafana — the threshold alone won't catch a slow climb
    'http_req_duration{scenario:soak}': [
      { threshold: 'p(95)<1000', abortOnFail: false },
    ],
  },
};

// VU state
let token = null;
let iterationCount = 0;

export default function () {
  iterationCount++;

  // Re-authenticate every 500 iterations (token expiry simulation)
  if (!token || iterationCount % 500 === 0) {
    token = login(envConfig.baseUrl, envConfig.credentials);
  }

  // Mix of read (80%) and write (20%) operations
  const roll = randomIntBetween(1, 10);

  if (roll <= 8) {
    // Read path
    const { itemId } = listItems(envConfig.baseUrl, token);
    getItem(envConfig.baseUrl, token, itemId);
  } else {
    // Write path — always clean up to avoid data accumulation over hours
    const createdId = createItem(envConfig.baseUrl, token);
    deleteItem(envConfig.baseUrl, token, createdId);
  }

  // Realistic think time — Gaussian distribution, mean 500ms
  sleep(randomIntBetween(100, 900) / 1000);
}
