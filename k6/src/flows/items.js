/**
 * Items CRUD flow — composable functions for building user journeys.
 *
 * Each function is independently callable so scenarios can mix and match:
 *   - Read-heavy: listItems + getItem
 *   - Write-heavy: createItem + updateItem + deleteItem
 *   - Full journey: all steps in sequence
 *
 * All functions accept a context object so state (itemId, etc.) threads
 * through the journey without global variables (not thread-safe in k6).
 */

import { get, post, put, del } from '../utils/http.js';
import { createItemPayload, updateItemPayload, listQueryParams } from '../utils/data.js';
import { assertResponse, expect } from '../utils/check.js';

/**
 * GET /api/items — paginated list.
 * Returns the first item ID for use in subsequent calls.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @returns {{ itemId: string|null, total: number }}
 */
export function listItems(baseUrl, token) {
  const params = listQueryParams();
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const res = get(`${baseUrl}/api/items?${query}`, token, 'list_items');

  assertResponse(
    res,
    expect.all(
      expect.status(200),
      expect.jsonField('data'),
      expect.responseTime(500),
    ),
    { context: 'items.listItems' }
  );

  let itemId = null;
  let total = 0;

  try {
    const body = res.json();
    const items = body.data || [];
    itemId = items.length > 0 ? items[0].id : null;
    total = body.total || items.length;
  } catch {
    // Non-fatal — item extraction failure doesn't fail the check
  }

  return { itemId, total };
}

/**
 * GET /api/items/:id — single item fetch.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} itemId
 * @returns {object|null} item data
 */
export function getItem(baseUrl, token, itemId) {
  if (!itemId) return null;

  const res = get(`${baseUrl}/api/items/${itemId}`, token, 'get_item');

  assertResponse(
    res,
    expect.all(
      expect.status(200),
      expect.jsonField('id'),
      expect.responseTime(300),
    ),
    { context: 'items.getItem' }
  );

  try {
    return res.json();
  } catch {
    return null;
  }
}

/**
 * POST /api/items — create new item.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @returns {string|null} created item ID
 */
export function createItem(baseUrl, token) {
  const payload = createItemPayload();
  const res = post(`${baseUrl}/api/items`, payload, token, 'create_item');

  assertResponse(
    res,
    expect.all(
      expect.status(201),
      expect.jsonField('id'),
      expect.responseTime(1000),
    ),
    { context: 'items.createItem' }
  );

  try {
    return res.json('id');
  } catch {
    return null;
  }
}

/**
 * PUT /api/items/:id — full update.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} itemId
 */
export function updateItem(baseUrl, token, itemId) {
  if (!itemId) return;

  const payload = updateItemPayload();
  const res = put(`${baseUrl}/api/items/${itemId}`, payload, token, 'update_item');

  assertResponse(
    res,
    expect.all(
      expect.status(200),
      expect.responseTime(1000),
    ),
    { context: 'items.updateItem' }
  );
}

/**
 * DELETE /api/items/:id — delete item.
 * Treats 404 as acceptable (idempotent delete).
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} itemId
 */
export function deleteItem(baseUrl, token, itemId) {
  if (!itemId) return;

  const res = del(`${baseUrl}/api/items/${itemId}`, token, 'delete_item');

  assertResponse(
    res,
    expect.statusIn(200, 204, 404),
    { context: 'items.deleteItem' }
  );
}

/**
 * Full CRUD journey: list → get → create → update → delete.
 * Represents a realistic user session.
 *
 * @param {string} baseUrl
 * @param {string} token
 */
export function fullCrudJourney(baseUrl, token) {
  // Read existing data
  const { itemId: existingId } = listItems(baseUrl, token);
  getItem(baseUrl, token, existingId);

  // Write cycle — always clean up after itself
  const createdId = createItem(baseUrl, token);
  updateItem(baseUrl, token, createdId);
  deleteItem(baseUrl, token, createdId);
}
