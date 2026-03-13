/**
 * Global setup — runs ONCE before any VU starts.
 *
 * Responsibilities:
 *   1. Health-check the target environment (fail fast, not 30 minutes in)
 *   2. Seed required test data (reference items for read scenarios)
 *   3. Create a shared auth token passed to all VUs via return value
 *
 * Return value is serialized as JSON and passed as `data` param
 * to the default function and teardown. Keep it small.
 *
 * NEVER put VU-level logic here. This runs once, on the k6 driver node.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { getEnvConfig } from './src/config/environments.js';
import { login } from './src/flows/auth.js';
import { post } from './src/utils/http.js';
import { createItemPayload } from './src/utils/data.js';

export default function setup() {
  const envConfig = getEnvConfig();
  const { baseUrl, credentials, env } = envConfig;

  console.log(`[setup] Target: ${env} @ ${baseUrl}`);

  // --- Step 1: Health check ---
  let healthy = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = http.get(`${baseUrl}/api/health`, { timeout: '5s' });
    if (res.status === 200) {
      healthy = true;
      console.log(`[setup] Health check passed (attempt ${attempt})`);
      break;
    }
    console.warn(`[setup] Health check failed (${res.status}), attempt ${attempt}/5`);
    sleep(5);
  }

  if (!healthy) {
    throw new Error(`[setup] Target ${baseUrl} is not healthy after 5 attempts. Aborting.`);
  }

  // --- Step 2: Authenticate ---
  const token = login(baseUrl, credentials);
  console.log('[setup] Authentication successful');

  // --- Step 3: Seed reference data ---
  // Pre-create items so read scenarios have data to fetch from the first iteration.
  // Without seeding, early iterations fail with 404 or empty lists.
  const seedItemIds = [];
  const seedCount = 20;

  for (let i = 0; i < seedCount; i++) {
    const res = post(`${baseUrl}/api/items`, createItemPayload(), token, 'setup_seed');
    if (res.status === 201) {
      try {
        const id = res.json('id');
        if (id) seedItemIds.push(id);
      } catch {
        // ignore
      }
    }
  }

  console.log(`[setup] Seeded ${seedItemIds.length}/${seedCount} items`);

  return {
    token,
    baseUrl,
    env,
    seedItemIds,
    setupTimestamp: Date.now(),
  };
}
