/**
 * Spike Test — Sudden traffic surge and recovery validation.
 *
 * Tests two critical behaviors:
 *   1. Surge resilience:  Does the system handle 10x normal load suddenly?
 *   2. Recovery:          After the spike drops, does latency return to baseline?
 *                         Recovery failure = memory leak, connection pool exhaustion,
 *                         or thread starvation — classic production incidents.
 *
 * Pattern: baseline → spike → baseline → spike → baseline
 * Two spikes verify the system recovers, not just survives once.
 */

import { sleep } from 'k6';
import { getEnvConfig } from '../config/environments.js';
import { getThresholds } from '../config/thresholds.js';
import { login } from '../flows/auth.js';
import { listItems, getItem } from '../flows/items.js';

const envConfig = getEnvConfig();

// Baseline = normal production load. Spike = 10x baseline.
const baselineRate = parseInt(__ENV.BASELINE_RATE || '30');
const spikeRate = parseInt(__ENV.SPIKE_RATE || '300');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: baselineRate,
      timeUnit: '1s',
      preAllocatedVUs: spikeRate,
      maxVUs: spikeRate * 3,
      stages: [
        { target: baselineRate, duration: '2m' },   // Establish baseline
        { target: spikeRate, duration: '30s' },      // Spike — 30s is realistic (viral event)
        { target: spikeRate, duration: '1m' },       // Hold spike
        { target: baselineRate, duration: '30s' },   // Drop back
        { target: baselineRate, duration: '3m' },    // Recovery observation — CRITICAL
        { target: spikeRate, duration: '30s' },      // Second spike — verify repeat resilience
        { target: spikeRate, duration: '1m' },
        { target: baselineRate, duration: '30s' },
        { target: baselineRate, duration: '2m' },    // Final recovery check
      ],
    },
  },

  thresholds: {
    // During baseline windows, SLOs should hold
    // During spike windows, we allow degradation but not total failure
    http_req_failed: [
      { threshold: 'rate<0.1', abortOnFail: true, delayAbortEval: '2m' },
    ],
    http_req_duration: [
      // P95 allowed to degrade under spike, but P99 should not go infinite
      { threshold: 'p(99)<10000', abortOnFail: true, delayAbortEval: '2m' },
    ],
  },
};

let token = null;

export default function () {
  if (!token) {
    token = login(envConfig.baseUrl, envConfig.credentials);
  }

  // Spike test is read-heavy — write ops under spike add risk to data integrity
  const { itemId } = listItems(envConfig.baseUrl, token);
  getItem(envConfig.baseUrl, token, itemId);

  sleep(0.1);
}
