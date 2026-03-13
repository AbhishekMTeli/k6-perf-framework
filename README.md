# k6 SDET Performance Testing Framework

A production-grade, code-first performance testing suite built on [k6](https://k6.io) with real-time observability, SLO-tied thresholds, baseline regression detection, and full CI/CD integration.

---

## Table of Contents

- [Why k6 Over JMeter](#why-k6-over-jmeter)
- [Framework Architecture](#framework-architecture)
- [Directory Structure](#directory-structure)
- [Quick Start](#quick-start)
- [Test Scenarios](#test-scenarios)
- [Configuration](#configuration)
- [Observability Stack](#observability-stack)
- [Baseline Regression Detection](#baseline-regression-detection)
- [CI/CD Integration](#cicd-integration)
- [SLO Thresholds](#slo-thresholds)
- [Writing New Tests](#writing-new-tests)

---

## Why k6 Over JMeter

| Concern | JMeter | k6 |
|---------|--------|----|
| **Test definition** | XML (JMX) — unreadable diffs, no meaningful PR review | JavaScript — code-reviewed like any other code |
| **Workload model** | Closed (threads wait for responses, masks saturation) | Open (`constant-arrival-rate` — real traffic behavior) |
| **CI/CD fit** | GUI tool bolted onto pipelines | Designed for headless pipeline execution |
| **Resource usage** | JVM, ~500 MB RAM per runner | Go binary, ~50 MB for 1000 VUs |
| **Real-time metrics** | Plugin required, off by default | Native `--out influxdb` flag |
| **Distributed load** | Manual master/worker config | `k6 cloud` or Kubernetes operator |
| **Extensibility** | Groovy + XML | Plain JavaScript |

### The Closed vs Open Workload Problem

In JMeter with 50 threads: if the server degrades to 2s per request, you generate 25 req/s. The tool adapts to the server — you never observe saturation.

In k6 with `constant-arrival-rate` at 50 req/s: if the server slows, VUs pile up, error rate climbs, latency blows out. That is what real traffic does. The breaking point is visible.

---

## Framework Architecture

```
                    ┌─────────────────────────────────┐
                    │         CI/CD Pipeline           │
                    │  GitHub Actions / Jenkins        │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │         scripts/run.sh           │
                    │  (scenario, env, output flags)   │
                    └────────────┬────────────────────┘
                                 │
              ┌──────────────────▼──────────────────────┐
              │              k6 Engine                   │
              │                                          │
              │  setup.js ──► scenario ──► teardown.js   │
              │  (health + seed)  │    (cleanup)         │
              │                   │                      │
              │            ┌──────▼──────┐               │
              │            │   flows/    │               │
              │            │  auth.js    │               │
              │            │  items.js   │               │
              │            └──────┬──────┘               │
              │                   │                      │
              │            ┌──────▼──────┐               │
              │            │   utils/    │               │
              │            │  http.js    │               │
              │            │  data.js    │               │
              │            │  check.js   │               │
              └────────────┴─────────────┴──────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │       Outputs                    │
                    │  InfluxDB ──► Grafana (live)     │
                    │  summary.json (threshold check)  │
                    │  baseline_history.json (trends)  │
                    └─────────────────────────────────┘
```

---

## Directory Structure

```
.
├── k6/
│   ├── src/
│   │   ├── config/
│   │   │   ├── environments.js     # Per-env base URLs and credentials
│   │   │   └── thresholds.js       # SLO-tied pass/fail thresholds per env
│   │   ├── utils/
│   │   │   ├── http.js             # HTTP wrapper: trace IDs, retry, metric tags
│   │   │   ├── data.js             # Test data factory (VU-scoped, reproducible)
│   │   │   └── check.js            # Assertion helpers with structured failure logs
│   │   ├── flows/
│   │   │   ├── auth.js             # Login, token refresh, logout
│   │   │   └── items.js            # Composable CRUD functions
│   │   └── scenarios/
│   │       ├── load.js             # Steady-state: constant-arrival-rate
│   │       ├── stress.js           # Progressive ramp to find breaking point
│   │       ├── spike.js            # Double-spike with recovery validation
│   │       └── soak.js             # 2h+ endurance for leak/drift detection
│   ├── setup.js                    # Global: health check + data seeding
│   └── teardown.js                 # Global: cleanup (runs even on abort)
│
├── scripts/
│   ├── run.sh                      # Main test runner
│   └── compare_baseline.py         # Rolling baseline regression comparison
│
├── docker/
│   ├── docker-compose.yml          # InfluxDB 2.7 + Grafana 10
│   └── grafana/
│       └── provisioning/           # Auto-provisioned datasource + dashboard
│
├── dashboards/
│   └── k6-dashboard.json           # Grafana: P50/P95/P99, throughput, per-endpoint
│
├── .github/
│   └── workflows/
│       └── perf.yml                # GitHub Actions pipeline
│
├── ci-cd/
│   └── Jenkinsfile                 # Jenkins declarative pipeline
│
└── results/                        # Generated at runtime (gitignored)
    ├── run_<timestamp>/
    │   ├── summary.json
    │   ├── raw_metrics.json
    │   └── k6_stdout.log
    └── baseline_history.json       # Persisted across runs for trend comparison
```

---

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| k6 | ≥ 0.50 | `brew install k6` |
| Python | ≥ 3.11 | `brew install python` |
| Docker | any | [docker.com](https://docker.com) |

### 1. Start the observability stack

```bash
docker compose -f docker/docker-compose.yml up -d
```

Grafana will be available at `http://localhost:3000` (admin / admin).

### 2. Run a load test locally

```bash
TARGET_ENV=local ./scripts/run.sh --scenario load
```

### 3. Run with live Grafana dashboard

```bash
TARGET_ENV=local ./scripts/run.sh --scenario load --influx
```

Open `http://localhost:3000` — metrics appear within 10 seconds of the test starting.

### 4. Run against staging with baseline check

```bash
STAGING_BASE_URL=https://api.staging.example.com \
STAGING_USER=perfuser \
STAGING_PASS=secret \
TARGET_ENV=staging ./scripts/run.sh --scenario load --env staging --baseline
```

### 5. Run specific scenario

```bash
# Stress test — find the breaking point
./scripts/run.sh --scenario stress --env staging

# Spike test — resilience + recovery
./scripts/run.sh --scenario spike --env staging

# Soak test — 2 hour endurance (memory leak detection)
SOAK_DURATION=7200 ./scripts/run.sh --scenario soak --env staging
```

---

## Test Scenarios

### Load Test (`load.js`)

**Purpose:** Validate steady-state performance at expected production traffic.

**Executor:** `constant-arrival-rate` (open workload model)

**Pattern:**
```
VUs: 0 ──[warm-up 2m]──► target rate ──[sustained 10m]──► drain
```

**Traffic split:** 80% read (list + get), 20% write (full CRUD journey)

**Override env vars:**
```bash
LOAD_RATE=100          # requests/second (default: 50)
LOAD_DURATION=900      # sustained duration in seconds (default: 600)
```

---

### Stress Test (`stress.js`)

**Purpose:** Find the system's breaking point and capacity ceiling.

**Executor:** `ramping-arrival-rate`

**Pattern:**
```
10% ──3m──► 20% ──3m──► 35% ──3m──► 50% ──3m──► 70% ──3m──► 85% ──3m──► 100%
                                                              ──► cool-down ──► hold
```

**What to look for:**
- At which stage does P95 breach the SLO? → **latency ceiling**
- At which stage does error rate climb? → **capacity limit**
- At which stage does throughput flatten (while load increases)? → **saturation point** (Little's Law)
- Does the system recover during cool-down? → **resilience**

**Override env vars:**
```bash
STRESS_MAX_RATE=1000   # peak rate (default: 500)
```

---

### Spike Test (`spike.js`)

**Purpose:** Validate resilience under sudden traffic surges and verify recovery.

**Pattern:**
```
baseline ──► [30s spike 10x] ──► baseline ──[3m recovery]──► [30s spike] ──► baseline
```

Two spikes are run intentionally. The second spike catches issues that only surface after an initial overload (connection pool exhaustion, thread starvation).

**What to look for:**
- Does the system absorb the spike without complete failure?
- Does latency **return to baseline** within 3 minutes of the spike dropping? (Recovery failure = memory leak or resource leak)
- Is the second spike handled as well as the first?

**Override env vars:**
```bash
BASELINE_RATE=30       # normal load (default: 30)
SPIKE_RATE=300         # spike peak (default: 300)
```

---

### Soak Test (`soak.js`)

**Purpose:** Detect issues that only appear under sustained load over hours.

**Duration:** 2 hours default (configurable up to 8 hours)

**What it catches that load tests miss:**

| Symptom in Grafana | Root Cause |
|--------------------|------------|
| P95 slowly climbing over hours | Memory leak / GC pressure |
| Error spikes at regular intervals | Cache TTL expiry / cron job contention |
| Error rate gradually increasing | Database connection leak |
| Throughput slowly declining | Thread pool starvation |
| Flat metrics throughout | Clean pass |

**Override env vars:**
```bash
SOAK_RATE=30           # req/s (60-70% of capacity, default: 30)
SOAK_DURATION=14400    # seconds (default: 7200 = 2 hours)
```

---

## Configuration

### Environment Variables

All configuration is injected at runtime via `-e` flags or shell environment. Nothing is hardcoded.

| Variable | Description | Default |
|----------|-------------|---------|
| `TARGET_ENV` | `local` \| `staging` \| `production` | `local` |
| `STAGING_BASE_URL` | Staging API base URL | — |
| `STAGING_USER` | Staging test user | — |
| `STAGING_PASS` | Staging test password | — |
| `PROD_BASE_URL` | Production API base URL | — |
| `PROD_USER` | Production test user | — |
| `PROD_PASS` | Production test password | — |
| `LOAD_RATE` | Requests per second for load test | `50` |
| `LOAD_DURATION` | Sustained duration in seconds | `600` |
| `STRESS_MAX_RATE` | Peak rate for stress test | `500` |
| `BASELINE_RATE` | Normal rate for spike test | `30` |
| `SPIKE_RATE` | Peak rate for spike test | `300` |
| `SOAK_RATE` | Rate for soak test | `30` |
| `SOAK_DURATION` | Soak test duration in seconds | `7200` |
| `INFLUX_URL` | InfluxDB URL for live output | `http://localhost:8086` |
| `INFLUX_TOKEN` | InfluxDB auth token | `perf-local-token` (local) |

### `scripts/run.sh` Flags

```
-s, --scenario    load | stress | spike | soak   (default: load)
-e, --env         local | staging | production   (default: local)
-o, --output-dir  results output path
--influx          enable real-time InfluxDB output
--baseline        run baseline regression check after test
--no-teardown     skip teardown (keep seeded data for debugging)
```

---

## Observability Stack

### Architecture

```
k6 ──[--out influxdb]──► InfluxDB 2.7 ──► Grafana 10
                              │
                         (time-series)
```

### Start / Stop

```bash
# Start
docker compose -f docker/docker-compose.yml up -d

# Stop (keep data)
docker compose -f docker/docker-compose.yml down

# Reset all data
docker compose -f docker/docker-compose.yml down -v
```

### Grafana Dashboard

URL: `http://localhost:3000` (admin / admin)

The k6 dashboard is auto-provisioned and includes:

| Panel | What It Shows |
|-------|---------------|
| Active VUs | Current virtual user count |
| Error Rate % | Real-time failure rate |
| Avg Response Time | Mean latency |
| Throughput (req/s) | Request rate |
| P50 / P95 over time | Latency percentile trends |
| Throughput + VU count | Correlation chart |
| P95 by endpoint | Bar gauge per API endpoint |

**Set the time range to `Last 15 minutes` with 10s auto-refresh during a test run.**

### InfluxDB credentials (local)

| Setting | Value |
|---------|-------|
| URL | `http://localhost:8086` |
| Org | `perf` |
| Bucket | `k6` |
| Token | `perf-local-token` |

---

## Baseline Regression Detection

Static thresholds alone miss slow degradation. If P95 was 80ms and is now 450ms, the test passes (both are under 500ms) — but performance has degraded 5x.

`scripts/compare_baseline.py` solves this by comparing every run against a rolling average of the last N runs.

### How It Works

1. After each run, `summary.json` is parsed and key metrics are stored in `results/baseline_history.json`
2. Each new run is compared against the rolling average of the last 10 runs
3. If any metric regresses beyond the configured percentage, the script exits `1` (CI fails)

### Tracked Metrics

- `http_req_duration` — P95, P99, median, avg
- `http_req_failed` — error rate
- `http_reqs` — throughput
- `checks_failed_total` — assertion failure count

### Usage

```bash
python3 scripts/compare_baseline.py \
  --current results/run_20240315/summary.json \
  --history results/baseline_history.json \
  --window 10 \
  --max-regression 20
```

### Example Output

```
Metric                                        Current     Baseline       Change   Status
-----------------------------------------------------------------------------------------------
http_req_duration.avg                          145.2000     142.3000       +2.0%     ✓  OK
http_req_duration.p(95)                        387.0000     321.0000      +20.6%  ❌ REGRESSED
http_req_duration.p(99)                        892.0000     874.0000       +2.1%     ✓  OK
http_req_failed.rate                             0.0012       0.0010      +20.0%     ✓  OK
http_reqs.rate                                  52.1000      51.8000       +0.6%     ✓  OK

[baseline] FAILED — 1 metric(s) regressed beyond 20%:
  - http_req_duration.p(95): 387.0000 vs baseline 321.0000 (+20.6%)
```

### In CI

The baseline history is persisted via GitHub Actions cache (keyed by env + scenario) so comparisons are stable across runs.

---

## CI/CD Integration

### GitHub Actions (`.github/workflows/perf.yml`)

**Triggers:**

| Event | What runs |
|-------|-----------|
| PR to `main` (k6 changes) | Validate only (dry-run, no actual load) |
| Push to `main` | Full load test on staging |
| Nightly (2 AM UTC) | Full load test on staging |
| `workflow_dispatch` | Manual — choose scenario + env + params |

**Jobs:**

1. **Validate** — dry-run all scenario files, catches syntax errors on every PR
2. **Run Performance Tests** — full test with threshold check + optional baseline comparison
3. **Publish Results** — deploy HTML artifacts to GitHub Pages (main branch only)

**Secrets required:**

```
STAGING_BASE_URL
STAGING_USER
STAGING_PASS
PROD_BASE_URL
PROD_USER
PROD_PASS
SLACK_BOT_TOKEN
```

### Jenkins (`ci-cd/Jenkinsfile`)

**Agent label:** `perf-runner` — assign this label to a dedicated Jenkins agent (not a shared build agent)

**Triggers:**
- Nightly cron: `0 1 * * *`
- Upstream: triggers after `deploy-staging` succeeds

**Credentials required in Jenkins credential store:**

```
staging-base-url
staging-perf-user
staging-perf-pass
prod-base-url
prod-perf-user
prod-perf-pass
```

**Plugins required:**
- HTML Publisher
- Slack Notification
- Email Extension
- AnsiColor

---

## SLO Thresholds

Thresholds are defined per environment in [k6/src/config/thresholds.js](k6/src/config/thresholds.js).

### Staging

| Metric | Threshold | Abort on fail |
|--------|-----------|---------------|
| P95 response time | < 1000ms | Yes (after 30s) |
| P99 response time | < 2000ms | Yes (after 30s) |
| Median response time | < 300ms | No |
| Error rate | < 1% | Yes (after 30s) |
| Throughput | > 10 req/s | No |

### Production

| Metric | Threshold | Abort on fail |
|--------|-----------|---------------|
| P95 response time | < 500ms | Yes (after 30s) |
| P99 response time | < 1000ms | Yes (after 30s) |
| Median response time | < 200ms | No |
| Error rate | < 0.1% | Yes (after 30s) |
| Throughput | > 50 req/s | No |

### Per-Endpoint (Staging Example)

| Endpoint | P95 Target |
|----------|-----------|
| `GET /api/items` (list) | < 500ms |
| `GET /api/items/:id` | < 300ms |
| `POST /api/items` | < 1000ms |
| `POST /api/auth/login` | < 500ms |

`delayAbortEval: '30s'` on all abort conditions gives the system a 30-second warm-up window before thresholds are evaluated.

---

## Writing New Tests

### Add a new endpoint to an existing flow

Edit [k6/src/flows/items.js](k6/src/flows/items.js) and add a new function following the existing pattern:

```javascript
export function searchItems(baseUrl, token, query) {
  const res = get(`${baseUrl}/api/items/search?q=${query}`, token, 'search_items');

  assertResponse(
    res,
    expect.all(
      expect.status(200),
      expect.jsonField('results'),
      expect.responseTime(300),
    ),
    { context: 'items.searchItems' }
  );

  try {
    return res.json('results');
  } catch {
    return [];
  }
}
```

Add a threshold for the new endpoint in `thresholds.js`:

```javascript
'http_req_duration{endpoint:search_items}': [
  { threshold: 'p(95)<300', abortOnFail: false },
],
```

### Add a new scenario

Create `k6/src/scenarios/your_scenario.js`:

```javascript
import { getEnvConfig } from '../config/environments.js';
import { getThresholds } from '../config/thresholds.js';
import { login } from '../flows/auth.js';
// import your flows

const envConfig = getEnvConfig();

export const options = {
  scenarios: {
    your_scenario: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 40,
      maxVUs: 200,
    },
  },
  thresholds: getThresholds(envConfig.env),
};

let token = null;

export default function () {
  if (!token) {
    token = login(envConfig.baseUrl, envConfig.credentials);
  }
  // your test logic
}
```

Run it:

```bash
./scripts/run.sh --scenario your_scenario --env staging
```

---

## Results Structure

Each run produces:

```
results/run_<timestamp>/
├── summary.json          # k6 summary with all metric values (thresholds in/out)
├── raw_metrics.json      # time-series data point for every metric
├── k6_stdout.log         # full k6 console output
├── k6.log                # structured JSON log (warnings + errors only)
└── baseline_report.json  # comparison vs rolling baseline (if --baseline was used)
```

`summary.json` is the source of truth for CI pass/fail. All threshold evaluation happens here.

---

## Troubleshooting

**VUs failing immediately with 401**

Check that credentials are set via env vars before running. The `setup.js` health check will catch this before VUs start.

**`dropped_iterations` counter is high**

The system cannot keep up with the configured arrival rate. Reduce `LOAD_RATE` or investigate the bottleneck before benchmarking at that rate.

**Grafana shows no data**

Confirm the test is running with `--influx` and that `INFLUX_TOKEN` matches the value in `docker-compose.yml` (`perf-local-token` for local).

**Baseline comparison fails on first run**

Expected — the baseline history needs at least 3 runs before comparison is meaningful. The script will store the run and exit `0` automatically.

**`teardown` reports items not cleaned up**

The items will remain in the test environment. Run `DELETE /api/items` manually for items tagged with `"source": "k6-perf-suite"` in their metadata.
