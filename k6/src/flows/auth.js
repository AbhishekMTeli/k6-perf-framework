/**
 * Auth flow — login and token lifecycle management.
 *
 * Design:
 *   - Each VU logs in once (in setup or first iteration) and caches the token.
 *   - Token refresh is handled if the API returns 401.
 *   - Credentials come from environment config, never hardcoded.
 */

import { post } from '../utils/http.js';
import { loginPayload } from '../utils/data.js';
import { assertResponse, expect } from '../utils/check.js';

/**
 * Authenticate and return a JWT token.
 * Call this in scenario setup or the first iteration of a VU.
 *
 * @param {string} baseUrl - from env config
 * @param {object} credentials - { username, password }
 * @returns {string} JWT token
 * @throws if login fails (hard fail — no point running the scenario without auth)
 */
export function login(baseUrl, credentials) {
  const payload = credentials
    ? { username: credentials.username, password: credentials.password }
    : loginPayload();

  const res = post(`${baseUrl}/api/auth/login`, payload, null, 'login');

  assertResponse(
    res,
    expect.all(
      expect.status(200),
      expect.jsonField('token'),
      expect.responseTime(1000),
    ),
    { hardFail: true, context: 'auth.login' }
  );

  return res.json('token');
}

/**
 * Refresh an expired token.
 * Returns new token or re-authenticates if refresh fails.
 *
 * @param {string} baseUrl
 * @param {string} refreshToken
 * @param {object} credentials - fallback for full re-auth
 */
export function refreshToken(baseUrl, refreshToken, credentials) {
  if (!refreshToken) {
    return login(baseUrl, credentials);
  }

  const res = post(
    `${baseUrl}/api/auth/refresh`,
    { refresh_token: refreshToken },
    null,
    'token_refresh'
  );

  if (res.status === 200) {
    return res.json('token');
  }

  // Refresh failed — fall back to full login
  return login(baseUrl, credentials);
}

/**
 * Logout and invalidate the session.
 * Call in VU teardown to clean up server-side sessions.
 *
 * @param {string} baseUrl
 * @param {string} token
 */
export function logout(baseUrl, token) {
  const res = post(`${baseUrl}/api/auth/logout`, {}, token, 'logout');

  assertResponse(
    res,
    expect.statusIn(200, 204),
    { context: 'auth.logout' }
  );
}
