/**
 * Global teardown — runs ONCE after all VUs finish.
 *
 * Receives the same `data` object returned by setup.
 *
 * Responsibilities:
 *   1. Delete all seeded reference data (environment hygiene)
 *   2. Log test duration and summary
 *   3. Optionally notify external systems (webhooks, test management tools)
 *
 * Teardown runs even if the test is aborted — so cleanup always happens.
 * This is the key difference from JMeter where a test abort leaves orphan data.
 */

import { getEnvConfig } from './src/config/environments.js';
import { del } from './src/utils/http.js';
import { login } from './src/flows/auth.js';

export default function teardown(data) {
  if (!data) {
    console.warn('[teardown] No setup data available, skipping cleanup');
    return;
  }

  const { token: setupToken, baseUrl, seedItemIds = [], setupTimestamp, env } = data;
  const envConfig = getEnvConfig();

  console.log(`[teardown] Starting cleanup on ${env} @ ${baseUrl}`);
  console.log(`[teardown] Test duration: ${((Date.now() - setupTimestamp) / 1000).toFixed(1)}s`);

  // Re-authenticate in case the setup token expired
  let token = setupToken;
  try {
    token = login(baseUrl, envConfig.credentials);
  } catch (e) {
    console.warn(`[teardown] Re-auth failed, using setup token: ${e.message}`);
  }

  // Delete all seeded items
  let deleted = 0;
  let failed = 0;

  for (const itemId of seedItemIds) {
    try {
      const res = del(`${baseUrl}/api/items/${itemId}`, token, 'teardown_cleanup');
      if (res.status === 200 || res.status === 204 || res.status === 404) {
        deleted++;
      } else {
        failed++;
        console.warn(`[teardown] Failed to delete item ${itemId}: ${res.status}`);
      }
    } catch (e) {
      failed++;
      console.error(`[teardown] Exception deleting item ${itemId}: ${e.message}`);
    }
  }

  console.log(`[teardown] Cleanup complete: ${deleted} deleted, ${failed} failed`);

  if (failed > 0) {
    console.error(
      `[teardown] ${failed} items were NOT cleaned up. Manual cleanup may be required.`
    );
  }
}
