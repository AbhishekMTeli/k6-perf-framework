/**
 * Environment configurations.
 * All runtime values injected via k6 -e flags or __ENV.
 * Never hardcode URLs or secrets here.
 */

const ENVS = {
  local: {
    baseUrl: 'http://localhost:8080',
    wsUrl: 'ws://localhost:8080',
    credentials: {
      username: __ENV.LOCAL_USER || 'testuser',
      password: __ENV.LOCAL_PASS || 'testpass',
    },
  },
  staging: {
    baseUrl: __ENV.STAGING_BASE_URL || 'https://api.staging.example.com',
    wsUrl: __ENV.STAGING_WS_URL || 'wss://api.staging.example.com',
    credentials: {
      username: __ENV.STAGING_USER,
      password: __ENV.STAGING_PASS,
    },
  },
  production: {
    baseUrl: __ENV.PROD_BASE_URL || 'https://api.example.com',
    wsUrl: __ENV.PROD_WS_URL || 'wss://api.example.com',
    credentials: {
      username: __ENV.PROD_USER,
      password: __ENV.PROD_PASS,
    },
  },
};

export function getEnvConfig() {
  const env = __ENV.TARGET_ENV || 'local';
  const config = ENVS[env];
  if (!config) {
    throw new Error(`Unknown TARGET_ENV: "${env}". Valid: ${Object.keys(ENVS).join(', ')}`);
  }
  return { ...config, env };
}
