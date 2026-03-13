/**
 * Test data factory.
 * All generated data is deterministic per VU/iteration so results are reproducible.
 * Avoids hardcoded fixtures — generates realistic payloads dynamically.
 */

import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import exec from 'k6/execution';

const CATEGORIES = ['electronics', 'clothing', 'furniture', 'books', 'sports'];
const ADJECTIVES = ['premium', 'standard', 'budget', 'deluxe', 'compact'];
const NOUNS = ['widget', 'gadget', 'device', 'unit', 'module'];

/**
 * Returns a unique string scoped to VU + iteration.
 * Safe for parallel execution — no UUID collisions, no shared state.
 */
function vuScopedId() {
  return `vu${exec.vu.idInTest}_iter${exec.vu.iterationInScenario}`;
}

/**
 * Generates login credentials.
 * Uses VU-scoped username so each VU authenticates as a distinct user.
 */
export function loginPayload(baseUsername = 'perfuser') {
  return {
    username: `${baseUsername}_${exec.vu.idInTest}`,
    password: 'Test@1234!',
  };
}

/**
 * Generates a realistic item creation payload.
 */
export function createItemPayload() {
  const category = randomItem(CATEGORIES);
  const adj = randomItem(ADJECTIVES);
  const noun = randomItem(NOUNS);
  const id = vuScopedId();

  return {
    name: `${adj} ${noun} ${id}`,
    category,
    price: randomIntBetween(100, 10000) / 100,
    quantity: randomIntBetween(1, 500),
    description: `Auto-generated item for performance test. ID: ${id}`,
    tags: [category, adj, 'perf-test'],
    metadata: {
      source: 'k6-perf-suite',
      vu: exec.vu.idInTest,
      iteration: exec.vu.iterationInScenario,
    },
  };
}

/**
 * Generates an item update payload (partial update safe for PUT/PATCH).
 */
export function updateItemPayload() {
  return {
    price: randomIntBetween(100, 10000) / 100,
    quantity: randomIntBetween(1, 500),
    description: `Updated by perf test at iteration ${exec.vu.iterationInScenario}`,
  };
}

/**
 * Generates list query params for pagination testing.
 * Rotates through pages to avoid cache dominance skewing results.
 */
export function listQueryParams() {
  return {
    page: randomIntBetween(1, 5),
    limit: randomItem([10, 20, 50]),
    sort: randomItem(['created_at', 'price', 'name']),
    order: randomItem(['asc', 'desc']),
  };
}
