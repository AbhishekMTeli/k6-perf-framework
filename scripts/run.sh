#!/usr/bin/env bash
# k6 test runner
# Usage: ./scripts/run.sh [OPTIONS]
#
# Options:
#   -s, --scenario    load|stress|spike|soak  (default: load)
#   -e, --env         local|staging|production (default: local)
#   -o, --output-dir  results output directory (default: results/run_<timestamp>)
#   --influx          enable real-time InfluxDB output
#   --baseline        run baseline comparison after test
#   --no-teardown     skip teardown (keep seeded data, useful for debugging)
#
# Environment variables passed through to k6:
#   STAGING_BASE_URL, STAGING_USER, STAGING_PASS
#   PROD_BASE_URL, PROD_USER, PROD_PASS
#   LOAD_RATE, LOAD_DURATION, STRESS_MAX_RATE, SOAK_DURATION, etc.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_DIR="$(dirname "$SCRIPT_DIR")"
K6_DIR="$SUITE_DIR/k6"
RESULTS_BASE="$SUITE_DIR/results"

# --- Defaults ---
SCENARIO="load"
TARGET_ENV="local"
RUN_ID="$(date +%Y%m%d_%H%M%S)"
OUTPUT_DIR="$RESULTS_BASE/run_${RUN_ID}"
INFLUX_ENABLED=false
BASELINE_ENABLED=false
SKIP_TEARDOWN=false
INFLUX_URL="${INFLUX_URL:-http://localhost:8086}"
INFLUX_ORG="${INFLUX_ORG:-perf}"
INFLUX_BUCKET="${INFLUX_BUCKET:-k6}"
INFLUX_TOKEN="${INFLUX_TOKEN:-}"

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    -s|--scenario)    SCENARIO="$2";    shift 2 ;;
    -e|--env)         TARGET_ENV="$2";  shift 2 ;;
    -o|--output-dir)  OUTPUT_DIR="$2";  shift 2 ;;
    --influx)         INFLUX_ENABLED=true; shift ;;
    --baseline)       BASELINE_ENABLED=true; shift ;;
    --no-teardown)    SKIP_TEARDOWN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Validation ---
VALID_SCENARIOS=("load" "stress" "spike" "soak")
if [[ ! " ${VALID_SCENARIOS[*]} " =~ " ${SCENARIO} " ]]; then
  echo "[ERROR] Unknown scenario: '$SCENARIO'. Valid: ${VALID_SCENARIOS[*]}"
  exit 1
fi

VALID_ENVS=("local" "staging" "production")
if [[ ! " ${VALID_ENVS[*]} " =~ " ${TARGET_ENV} " ]]; then
  echo "[ERROR] Unknown env: '$TARGET_ENV'. Valid: ${VALID_ENVS[*]}"
  exit 1
fi

# --- Check k6 installation ---
if ! command -v k6 &>/dev/null; then
  echo "[ERROR] k6 not found. Install: https://k6.io/docs/getting-started/installation/"
  exit 1
fi

K6_VERSION=$(k6 version | head -1)
echo "[run] k6: $K6_VERSION"
echo "[run] Scenario: $SCENARIO | Env: $TARGET_ENV | Run ID: $RUN_ID"

# --- Prepare output ---
mkdir -p "$OUTPUT_DIR"

SUMMARY_FILE="$OUTPUT_DIR/summary.json"
LOG_FILE="$OUTPUT_DIR/k6.log"
SCENARIO_FILE="$K6_DIR/src/scenarios/${SCENARIO}.js"

if [[ ! -f "$SCENARIO_FILE" ]]; then
  echo "[ERROR] Scenario file not found: $SCENARIO_FILE"
  exit 1
fi

# --- Build k6 output flags ---
K6_OUTPUTS="--out json=$OUTPUT_DIR/raw_metrics.json"

if [[ "$INFLUX_ENABLED" == "true" ]]; then
  if [[ -z "$INFLUX_TOKEN" ]]; then
    echo "[WARN] INFLUX_TOKEN not set, InfluxDB output may fail"
  fi
  K6_OUTPUTS="$K6_OUTPUTS --out influxdb=$INFLUX_URL/k6"
  echo "[run] InfluxDB output: $INFLUX_URL"
fi

# --- Build k6 env flags ---
K6_ENV_FLAGS=(
  "-e" "TARGET_ENV=$TARGET_ENV"
)

# Pass through optional overrides if set
for VAR in LOAD_RATE LOAD_DURATION STRESS_MAX_RATE BASELINE_RATE SPIKE_RATE SOAK_RATE SOAK_DURATION; do
  if [[ -n "${!VAR:-}" ]]; then
    K6_ENV_FLAGS+=("-e" "$VAR=${!VAR}")
  fi
done

# --- Run test ---
echo "[run] Starting test..."
echo "[run] Output directory: $OUTPUT_DIR"

set +e
k6 run \
  "${K6_ENV_FLAGS[@]}" \
  --summary-export "$SUMMARY_FILE" \
  --log-output "file=$LOG_FILE" \
  --log-format json \
  $K6_OUTPUTS \
  "$SCENARIO_FILE" \
  2>&1 | tee "$OUTPUT_DIR/k6_stdout.log"

K6_EXIT_CODE=$?
set -e

echo "[run] k6 exit code: $K6_EXIT_CODE"

# --- Baseline comparison ---
if [[ "$BASELINE_ENABLED" == "true" ]] && [[ -f "$SUMMARY_FILE" ]]; then
  echo "[run] Running baseline comparison..."
  HISTORY_FILE="$RESULTS_BASE/baseline_history.json"

  set +e
  python3 "$SCRIPT_DIR/compare_baseline.py" \
    --current "$SUMMARY_FILE" \
    --history "$HISTORY_FILE" \
    --run-id "$RUN_ID" \
    --output "$OUTPUT_DIR/baseline_report.json"
  BASELINE_EXIT=$?
  set -e

  if [[ $BASELINE_EXIT -ne 0 ]]; then
    echo "[run] Baseline regression detected"
    K6_EXIT_CODE=1
  fi
fi

# --- Summary ---
echo ""
echo "=========================================="
echo " Run complete: $RUN_ID"
echo " Scenario:     $SCENARIO"
echo " Environment:  $TARGET_ENV"
echo " Results:      $OUTPUT_DIR"
echo " Status:       $([ $K6_EXIT_CODE -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo "=========================================="

exit $K6_EXIT_CODE
